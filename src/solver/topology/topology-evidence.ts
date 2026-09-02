import type { ArtifactRecord } from "../../cad/artifact-contract";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import { compileStructuralStudy } from "../structural/compile-structural-study";
import type { StructuralResult } from "../structural/structural-contract";
import { validateInteractiveStructuralResult } from "../structural/structural-result-validation";
import {
  assertTopologyInterfacesConnected, topologyDiscreteLimits, topologyMask,
} from "./density-constraints";
import { extractTopologyMesh, rasterizeExtractedTopology, validateExtractedTopology } from "./extract-topology";
import type {
  TopologyObjectiveSample, TopologySolveInput,
} from "./topology-contract";
import {
  configuredTopologyStudy, topologyPassiveCells, validateInitialDensity,
} from "./topology-input";
import { structuralRequestForTopologyMask } from "./topology-structural-request";

type Request = EngineeringSolveRequest<TopologySolveInput>;

export async function topologyStructuralDigest(result: StructuralResult): Promise<string> {
  return digestArtifactPayload({
    displacementM: new Float32Array(result.displacementM),
    vonMisesStressPa: new Float32Array(result.vonMisesStressPa),
    metrics: new Float64Array([
      result.iterations, result.complianceJ, result.strainEnergyJ,
      result.maximumDisplacementM, result.maximumVonMisesStressPa,
      result.verification.relativeResidual, result.verification.recomputedF32RelativeResidual,
      result.verification.gpuReactionBalanceErrorN, result.verification.wasmForceBalanceErrorN,
      ...result.verification.wasmReactionN, result.verification.appliedLoadN,
      result.verification.wasmRelativeL2, result.verification.wasmFieldStressRelativeL2,
      result.verification.energyRelativeMismatch,
    ]),
  });
}

function sameMask(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  return left.length === right.length
    && Array.from(left).every((value, index) => value === right[index]);
}

function validateProgression(input: Readonly<{
  density: Float32Array;
  initialDensity: Float32Array;
  binaryMasks: readonly Uint8Array[];
  isoValue: number;
  targetVolumeFraction: number;
  moveLimit: number;
  designDomain: Uint32Array;
  required: ReadonlySet<number>;
  protectedCells: ReadonlySet<number>;
}>): void {
  const limits = topologyDiscreteLimits(
    input.targetVolumeFraction, input.moveLimit, input.designDomain,
    input.required, input.protectedCells,
  );
  if ([...input.required].some((cell) => input.density[cell] !== 1)) {
    throw new Error("Topology final density must keep every required passive cell at one");
  }
  if ([...input.protectedCells].some((cell) => input.density[cell] !== 0)) {
    throw new Error("Topology final density must keep every protected void cell at zero");
  }
  const initialMask = topologyMask(input.initialDensity, input.isoValue, input.designDomain);
  if (!sameMask(initialMask, input.binaryMasks[0]!)) {
    throw new Error("Topology initial mask must exactly match the canonical initial density");
  }
  let previous: Uint8Array | undefined;
  let previousCount = 0;
  for (const [index, mask] of input.binaryMasks.entries()) {
    if (!(mask instanceof Uint8Array) || mask.length !== input.designDomain.length
      || mask.some((value, cell) => value !== 0 && value !== 1
        || value === 1 && input.designDomain[cell] !== 1)) {
      throw new Error("Topology analysis mask escapes the canonical design domain");
    }
    if ([...input.required].some((cell) => mask[cell] !== 1)) {
      throw new Error("Topology analysis mask omits a required passive cell");
    }
    if ([...input.protectedCells].some((cell) => mask[cell] !== 0)) {
      throw new Error("Topology analysis mask occupies a protected void cell");
    }
    const count = mask.reduce((sum, value) => sum + value, 0);
    if (index < input.binaryMasks.length - 1 && count <= limits.targetCount) {
      throw new Error("Topology pre-final analyzed mask must retain material above the rounded target volume");
    }
    if (previous) {
      let hamming = 0;
      let reentered = false;
      for (let cell = 0; cell < mask.length; cell += 1) {
        if (mask[cell] !== previous[cell]) hamming += 1;
        if (mask[cell] === 1 && previous[cell] === 0) reentered = true;
      }
      if (hamming > limits.moveBudget) throw new Error("Topology analyzed mask exceeds the discrete move budget");
      if (count > previousCount) throw new Error("Topology analyzed material count must not increase");
      if (reentered) throw new Error("Topology analyzed material must not re-enter a removed cell");
    }
    previous = mask;
    previousCount = count;
  }
  if (previousCount !== limits.targetCount) {
    throw new Error("Topology final analyzed mask misses the rounded target volume cell count");
  }
}

export async function canonicalTopologyEvidence(input: Readonly<{
  request: Request;
  density: Float32Array;
  binaryMasks: readonly Uint8Array[];
  analyses: readonly StructuralResult[];
}>) {
  const study = configuredTopologyStudy(input.request);
  const source = input.request.input.sourceStructuralRequest;
  const system = await compileStructuralStudy(source);
  const passive = topologyPassiveCells(input.request, study);
  validateInitialDensity(
    input.request.input, system.activeCells, passive.requiredCells, passive.protectedCells,
  );
  if (!(input.density instanceof Float32Array) || input.density.length !== system.activeCells.length
    || input.density.some((value, cell) => !Number.isFinite(value) || value < 0 || value > 1
      || system.activeCells[cell] === 0 && value !== 0)) {
    throw new Error("Topology final density is outside the canonical design domain");
  }
  if (input.binaryMasks.length < 1 || input.binaryMasks.length > study.maxIterations + 1
    || input.analyses.length !== input.binaryMasks.length) {
    throw new Error("Topology evidence must align every completed analysis with its binary mask");
  }
  validateProgression({
    density: input.density, initialDensity: input.request.input.initialDensity,
    binaryMasks: input.binaryMasks, isoValue: study.extraction.isoValue,
    targetVolumeFraction: study.targetVolumeFraction, moveLimit: study.moveLimit,
    designDomain: system.activeCells,
    required: passive.requiredCells, protectedCells: passive.protectedCells,
  });
  const samples: TopologyObjectiveSample[] = [];
  for (const [iteration, bytes] of input.binaryMasks.entries()) {
    const mask = Uint32Array.from(bytes);
    assertTopologyInterfacesConnected(mask, system.grid.cellDimensions, passive.requiredInterfaces);
    const derived = await structuralRequestForTopologyMask(source, mask, `iteration-${iteration}`);
    const compiled = await compileStructuralStudy(derived.request);
    const analysis = input.analyses[iteration]!;
    validateInteractiveStructuralResult(derived.request, compiled, analysis);
    if (!(analysis.complianceJ > 0)) throw new Error("Topology structural objective must be positive");
    if (samples.length && analysis.complianceJ < samples.at(-1)!.objectiveJ * (1 - 1e-5)) {
      throw new Error("Topology compliance decreased beyond locked numerical tolerance during material removal");
    }
    samples.push({
      iteration, objectiveJ: analysis.complianceJ, maskDigest: derived.maskDigest,
      structuralResultDigest: await topologyStructuralDigest(analysis),
    });
  }
  const finalMask = topologyMask(input.density, study.extraction.isoValue, system.activeCells);
  if (!sameMask(finalMask, input.binaryMasks.at(-1)!)) {
    throw new Error("Topology final density does not match its final analyzed mask");
  }
  const mesh = extractTopologyMesh(system.grid, input.density, study.extraction, system.activeCells);
  const extraction = validateExtractedTopology(mesh, system.grid, {
    requiredInterfaces: passive.requiredInterfaces,
    protectedVoidCellIndices: Uint32Array.from(passive.protectedCells),
    minimumFeatureM: study.minimumFeatureM,
  });
  if (Object.values(extraction).some((value) => !value)) {
    throw new Error("Topology extracted candidate failed manufacturing validation");
  }
  const rerasterized = rasterizeExtractedTopology(mesh, system.grid);
  if (!sameMask(rerasterized, finalMask)) {
    throw new Error("Topology extracted mesh does not reproduce the final analyzed mask");
  }
  return { study, system, samples, mesh, extraction, rerasterized };
}

export async function validateTopologyPostAnalysis(
  request: Request,
  meshArtifact: ArtifactRecord,
  rerasterized: Uint32Array,
  result: StructuralResult,
) {
  const source = request.input.sourceStructuralRequest;
  const post = await structuralRequestForTopologyMask(
    source, rerasterized, "post-extraction", meshArtifact, request.studyId,
  );
  const system = await compileStructuralStudy(post.request);
  validateInteractiveStructuralResult(post.request, system, result);
  return post;
}
