import { describe, expect, it } from "vitest";

import { defineArtifactRecord } from "../../cad/artifact-contract";
import { defineDesignDocument } from "../../cad/document-schema";
import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { createArtifactStore, digestArtifactPayload } from "../../engineering/artifact-store";
import { compileStructuralStudy } from "../structural/compile-structural-study";
import {
  STRUCTURAL_VERIFICATION_METADATA,
  type StructuralResult,
} from "../structural/structural-contract";
import { structuralRequest } from "../structural/structural-test-fixtures";
import { packInteractiveTopologyRunResult } from "./topology-artifacts";
import type { TopologySolveInput } from "./topology-contract";
import { structuralRequestForTopologyMask } from "./topology-structural-request";

async function request() {
  const sourceStructuralRequest = await structuralRequest();
  return defineEngineeringSolveRequest<TopologySolveInput>({
    jobId: "canonical-pack", kind: "topology", sourceRevision: sourceStructuralRequest.sourceRevision,
    inputArtifacts: sourceStructuralRequest.inputArtifacts, settings: {}, studyId: "bar-topology",
    document: sourceStructuralRequest.document,
    input: { sourceStructuralRequest, initialDensity: new Float32Array(16).fill(1) },
  });
}

async function analysis(
  source: Awaited<ReturnType<typeof structuralRequest>>,
  mask: Uint8Array,
  stage: string,
  complianceJ: number,
): Promise<StructuralResult> {
  const derived = await structuralRequestForTopologyMask(source, Uint32Array.from(mask), stage);
  const system = await compileStructuralStudy(derived.request);
  const displacementM = new Float32Array(system.fixedDofs.length);
  displacementM[0] = 0.01;
  return {
    truthLevel: "interactive-estimate", grid: system.grid, iterations: 4,
    complianceJ, strainEnergyJ: complianceJ / 2,
    maximumDisplacementM: displacementM[0]!, maximumVonMisesStressPa: 10,
    verification: {
      relativeResidual: 1e-6, forceBalanceErrorN: 0.01, appliedLoadN: 1000,
      wasmRelativeL2: 1e-4, realGpu: true, metadata: STRUCTURAL_VERIFICATION_METADATA,
    },
    rasterization: system.rasterization, displacementM,
    vonMisesStressPa: new Float32Array(system.activeCells.length).fill(10),
  };
}

async function canonicalEvidence() {
  const topology = await request();
  const source = topology.input.sourceStructuralRequest;
  const masks = [
    new Uint8Array(16).fill(1),
    new Uint8Array(16).fill(1),
    new Uint8Array([1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1]),
  ];
  const analyses = await Promise.all(masks.map((mask, index) =>
    analysis(source, mask, `iteration-${index}`, 100 + index * 10)));
  const postAnalysis = await analysis(source, masks[2]!, "post-probe", 130);
  return {
    request: topology,
    density: new Float32Array([1, 1, 1, 1, 1, 0.4, 0.4, 1, 1, 1, 1, 1, 1, 0.4, 0.4, 1]),
    binaryMasks: masks,
    analyses,
    postAnalysis,
  };
}

async function withMasks(
  base: Readonly<{
    request: Awaited<ReturnType<typeof request>>;
    density: Float32Array<ArrayBufferLike>;
    binaryMasks: readonly Uint8Array<ArrayBufferLike>[];
    analyses: readonly StructuralResult[];
    postAnalysis: StructuralResult;
  }>,
  masks: Uint8Array<ArrayBufferLike>[],
  density = base.density,
) {
  const source = base.request.input.sourceStructuralRequest;
  return {
    ...base, density, binaryMasks: masks,
    analyses: await Promise.all(masks.map((mask, index) =>
      analysis(source, mask, `iteration-${index}`, 100 + index * 10))),
    postAnalysis: await analysis(source, masks.at(-1)!, "post-probe", 130),
  };
}

async function protectedEvidence() {
  const original = await structuralRequest();
  const { revision: _revision, ...content } = original.document;
  const fixed = original.document.namedSelections[0]!;
  const document = await defineDesignDocument({
    ...content,
    namedSelections: [...content.namedSelections, {
      ...fixed, id: "keep-clear",
      reference: { ...fixed.reference, stableId: "face:bar:void" },
    }],
    studies: content.studies.map((study) => study.kind === "topology"
      ? { ...study, protectedVoidSelectionIds: ["keep-clear"] }
      : study),
  });
  const sourcePayload = original.input.voxelPayload;
  const topologyIds = JSON.stringify(["face:bar:fixed", "face:bar:loaded", "face:bar:void"]);
  const voxelPayload = {
    ...sourcePayload,
    dimensions: new Uint32Array(sourcePayload.dimensions),
    originM: new Float64Array(sourcePayload.originM),
    cellSizeM: new Float64Array(sourcePayload.cellSizeM),
    activeCells: new Uint32Array(sourcePayload.activeCells),
    selectionTopologyIdsUtf8: Uint8Array.from(new TextEncoder().encode(topologyIds)),
    selectionCellOffsets: new Uint32Array([0, 4, 8, 9]),
    selectionCellIndices: new Uint32Array([...sourcePayload.selectionCellIndices, 5]),
    selectionNodeOffsets: new Uint32Array([0, 9, 18, 18]),
    selectionNodeIndices: new Uint32Array(sourcePayload.selectionNodeIndices),
    rasterizationToleranceM: new Float64Array(sourcePayload.rasterizationToleranceM),
  };
  const originalMesh = original.inputArtifacts.find(({ id }) => id === original.input.semanticMeshArtifactId)!;
  const { id: _meshId, ...meshContent } = originalMesh;
  const mesh = await defineArtifactRecord({ ...meshContent, sourceRevision: document.revision });
  const originalVoxel = original.inputArtifacts.find(({ id }) => id === original.input.voxelArtifactId)!;
  const { id: _voxelId, ...voxelContent } = originalVoxel;
  const voxel = await defineArtifactRecord({
    ...voxelContent, sourceRevision: document.revision,
    contentDigest: await digestArtifactPayload(voxelPayload),
    dependencies: originalVoxel.dependencies.map((dependency) => dependency.kind === "artifact"
      ? { ...dependency, artifactId: mesh.id }
      : dependency),
  });
  const source = await defineEngineeringSolveRequest({
    ...original, sourceRevision: document.revision, document, inputArtifacts: [mesh, voxel],
    input: {
      ...original.input, semanticMeshArtifactId: mesh.id,
      voxelArtifactId: voxel.id, voxelPayload,
    },
  });
  const topology = await defineEngineeringSolveRequest<TopologySolveInput>({
    jobId: "protected-pack", kind: "topology", sourceRevision: document.revision,
    inputArtifacts: source.inputArtifacts, settings: {}, studyId: "bar-topology", document,
    input: {
      sourceStructuralRequest: source,
      initialDensity: Float32Array.from(sourcePayload.activeCells, (value, cell) => cell === 5 ? 0 : value),
    },
  });
  const baseline = Uint8Array.from(sourcePayload.activeCells); baseline[5] = 0;
  const finalMask = new Uint8Array([1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1]);
  const masks = [baseline, new Uint8Array(baseline), finalMask];
  const density = Float32Array.from(finalMask);
  return withMasks({
    request: topology, density, binaryMasks: masks,
    analyses: [], postAnalysis: undefined as never,
  }, masks, density);
}

describe("canonical topology artifact packaging", () => {
  it("rederives every artifact and decision from canonical revision-owned evidence", async () => {
    const packed = await packInteractiveTopologyRunResult(await canonicalEvidence());
    expect(packed.artifacts).toHaveLength(6);
    await expect(createArtifactStore().commit(packed.artifacts, () => true)).resolves.toBeUndefined();
    const mesh = packed.artifacts.find(({ record }) => record.kind === "manufacturing-mesh")!;
    const voxel = packed.artifacts.find(({ record }) => record.kind === "solver-mesh")!;
    const source = (await request()).input.sourceStructuralRequest;
    expect(voxel.record.dependencies).toEqual(expect.arrayContaining([
      { kind: "artifact", artifactId: mesh.record.id },
      { kind: "artifact", artifactId: source.input.semanticMeshArtifactId },
    ]));
    expect(packed.output).toMatchObject({
      truthLevel: "interactive-estimate",
      acceptance: { accepted: false, exportable: false, promotionRequired: "task-5-live-gate" },
    });
  });

  it("rejects independent density, mask, iteration-analysis, and post-analysis mutations", async () => {
    const base = await canonicalEvidence();
    const badDensity = new Float32Array(base.density); badDensity[0] = Number.NaN;
    const badMask = base.binaryMasks.map((mask) => new Uint8Array(mask)); badMask[2]![0] = 0;
    const badIteration = [...base.analyses];
    badIteration[1] = { ...badIteration[1]!, complianceJ: 91 };
    const badPost = { ...base.postAnalysis, displacementM: new Float32Array([Number.NaN]) };
    const badInitial = new Float32Array(base.request.input.initialDensity); badInitial[0] = Number.NaN;
    const forgedDocument = {
      ...base.request.document,
      studies: base.request.document.studies.map((study) => study.kind === "topology"
        && study.configurationState === "configured"
        ? { ...study, acceptance: { ...study.acceptance, maximumMaterialFraction: 0.1 } }
        : study),
    };
    for (const evidence of [
      { ...base, density: badDensity },
      { ...base, binaryMasks: badMask },
      { ...base, analyses: badIteration },
      { ...base, postAnalysis: badPost },
      { ...base, request: { ...base.request, input: { ...base.request.input, initialDensity: badInitial } } },
      { ...base, request: { ...base.request, document: forgedDocument } as never },
    ]) {
      await expect(packInteractiveTopologyRunResult(evidence)).rejects.toThrow();
    }
  });

  it("rejects a missing required passive cell in an intermediate analyzed mask", async () => {
    const base = await canonicalEvidence();
    const masks = base.binaryMasks.map((mask) => new Uint8Array(mask));
    masks[1]![0] = 0;
    await expect(packInteractiveTopologyRunResult({ ...base, binaryMasks: masks })).rejects.toThrow(/required/i);
  });

  it("rejects a discrete mask move beyond floor(moveLimit times source-domain cells)", async () => {
    const base = await canonicalEvidence();
    const finalMask = new Uint8Array(base.binaryMasks[2]!);
    const baseline = new Uint8Array(16).fill(1); baseline[2] = 0;
    await expect(packInteractiveTopologyRunResult(await withMasks(
      base, [new Uint8Array(16).fill(1), baseline, finalMask],
    ))).rejects.toThrow(/move budget/i);
  });

  it("rejects material-count increase even when the Hamming move is within budget", async () => {
    const base = await canonicalEvidence();
    const finalMask = new Uint8Array(base.binaryMasks[2]!);
    const initial = new Uint8Array(finalMask); initial[14] = 1;
    const reduced = new Uint8Array(finalMask); reduced[9] = 0;
    const initialDensity = Float32Array.from(initial);
    const revised = {
      ...base,
      request: { ...base.request, input: { ...base.request.input, initialDensity } },
    };
    await expect(packInteractiveTopologyRunResult(await withMasks(
      revised, [initial, reduced, finalMask],
    ))).rejects.toThrow(/material count/i);
  });

  it("rejects a final analyzed and rerasterized mask that misses the rounded target count", async () => {
    const base = await canonicalEvidence();
    const finalMask = new Uint8Array(base.binaryMasks[2]!); finalMask[5] = 1;
    const density = new Float32Array(base.density); density[5] = 1;
    await expect(packInteractiveTopologyRunResult(await withMasks(
      base, [new Uint8Array(16).fill(1), new Uint8Array(finalMask), finalMask], density,
    ))).rejects.toThrow(/target volume/i);
  });

  it("requires final continuous density to hold passive required cells exactly at one", async () => {
    const base = await canonicalEvidence();
    const density = new Float32Array(base.density); density[0] = 0.75;
    await expect(packInteractiveTopologyRunResult({ ...base, density })).rejects.toThrow(/required/i);
  });

  it("rejects protected-void material in an intermediate analyzed mask", async () => {
    const base = await protectedEvidence();
    const masks = base.binaryMasks.map((mask) => new Uint8Array(mask));
    masks[1]![5] = 1; masks[1]![6] = 0;
    await expect(packInteractiveTopologyRunResult(await withMasks(base, masks))).rejects.toThrow(/protected/i);
  });

  it("requires final continuous density to hold protected voids exactly at zero", async () => {
    const base = await protectedEvidence();
    const density = new Float32Array(base.density); density[5] = 0.4;
    await expect(packInteractiveTopologyRunResult({ ...base, density })).rejects.toThrow(/protected/i);
  });

  it("rejects a target-only history that omits the canonical full initial mask", async () => {
    const base = await canonicalEvidence();
    const target = new Uint8Array(base.binaryMasks[2]!);
    await expect(packInteractiveTopologyRunResult(await withMasks(
      base, [target, new Uint8Array(target), new Uint8Array(target)],
    ))).rejects.toThrow(/initial mask/i);
  });

  it("rejects equal-count cell swaps that re-enter material after removal", async () => {
    const base = await canonicalEvidence();
    const full = new Uint8Array(base.binaryMasks[0]!);
    const swapped = new Uint8Array([1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1]);
    const target = new Uint8Array(base.binaryMasks[2]!);
    await expect(packInteractiveTopologyRunResult(await withMasks(
      base, [full, swapped, target],
    ))).rejects.toThrow(/re-enter/i);
  });

  it("accepts the canonical initial mask followed only by material removal", async () => {
    const base = await canonicalEvidence();
    const full = new Uint8Array(base.binaryMasks[0]!);
    const target = new Uint8Array(base.binaryMasks[2]!);
    await expect(packInteractiveTopologyRunResult(await withMasks(
      base, [full, target, new Uint8Array(target)],
    ))).resolves.toMatchObject({ output: { materialFraction: 0.75 } });
  });
});
