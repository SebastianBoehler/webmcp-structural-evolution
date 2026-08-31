import type { ArtifactRecord } from "../../cad/artifact-contract";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import { compileStructuralStudy } from "../structural/compile-structural-study";
import type { StructuralResult } from "../structural/structural-contract";
import { validateInteractiveStructuralResult } from "../structural/structural-result-validation";
import { topologyMask } from "./density-constraints";
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
      result.verification.relativeResidual, result.verification.forceBalanceErrorN,
      result.verification.appliedLoadN, result.verification.wasmRelativeL2,
    ]),
  });
}

function sameMask(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  return left.length === right.length
    && Array.from(left).every((value, index) => value === right[index]);
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
  if (input.binaryMasks.length !== study.maxIterations + 1
    || input.analyses.length !== input.binaryMasks.length) {
    throw new Error("Topology evidence must contain one analysis per configured iteration");
  }
  const samples: TopologyObjectiveSample[] = [];
  for (const [iteration, bytes] of input.binaryMasks.entries()) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== system.activeCells.length
      || bytes.some((value, cell) => value !== 0 && value !== 1
        || value === 1 && system.activeCells[cell] !== 1)) {
      throw new Error("Topology analysis mask escapes the canonical design domain");
    }
    const mask = Uint32Array.from(bytes);
    const derived = await structuralRequestForTopologyMask(source, mask, `iteration-${iteration}`);
    const compiled = await compileStructuralStudy(derived.request);
    const analysis = input.analyses[iteration]!;
    validateInteractiveStructuralResult(derived.request, compiled, analysis);
    if (samples.length && analysis.complianceJ > samples.at(-1)!.objectiveJ) {
      throw new Error("Topology objective history is not monotonic");
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
  const post = await structuralRequestForTopologyMask(source, rerasterized, "post-extraction", meshArtifact);
  const system = await compileStructuralStudy(post.request);
  validateInteractiveStructuralResult(post.request, system, result);
  return post;
}
