import { describe, expect, it } from "vitest";

import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { createArtifactStore } from "../../engineering/artifact-store";
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
    new Uint8Array([1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
  ];
  const analyses = await Promise.all(masks.map((mask, index) =>
    analysis(source, mask, `iteration-${index}`, 100 - index * 10)));
  const postAnalysis = await analysis(source, masks[2]!, "post-probe", 70);
  return {
    request: topology,
    density: new Float32Array([1, 1, 1, 1, 1, 0.4, 0.4, 1, 1, 0.4, 0.4, 1, 1, 0.4, 0.4, 1]),
    binaryMasks: masks,
    analyses,
    postAnalysis,
  };
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
});
