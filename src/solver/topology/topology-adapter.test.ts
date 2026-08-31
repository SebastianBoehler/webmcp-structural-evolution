import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { SolverAdapter } from "../../engineering/solver-adapter";
import { TopologyStudySchema } from "../../engineering/study-schema";
import { compileStructuralStudy } from "../structural/compile-structural-study";
import {
  STRUCTURAL_VERIFICATION_METADATA,
  type StructuralResult,
  type StructuralSolveInput,
} from "../structural/structural-contract";
import { structuralRequest } from "../structural/structural-test-fixtures";
import { createWebGpuTopologyAdapter, type TopologySolveInput } from "./topology-adapter";

const dependencies = vi.hoisted(() => ({
  filter: vi.fn(), update: vi.fn(), structuralRun: vi.fn(),
}));

vi.mock("./topology-gpu", () => ({
  filterTopologyDensity: dependencies.filter,
  updateTopologyDensity: dependencies.update,
}));
vi.mock("../structural/webgpu-structural-adapter", () => ({
  createWebGpuStructuralAdapter: () => ({
    capability: { kind: "fea" }, supports: () => ({ supported: true }), run: dependencies.structuralRun,
  }),
}));

async function request(jobId: string) {
  const sourceStructuralRequest = await structuralRequest();
  return defineEngineeringSolveRequest<TopologySolveInput>({
    jobId, kind: "topology", sourceRevision: sourceStructuralRequest.sourceRevision,
    inputArtifacts: sourceStructuralRequest.inputArtifacts, settings: {}, studyId: "bar-topology",
    document: sourceStructuralRequest.document,
    input: {
      sourceStructuralRequest,
      initialDensity: new Float32Array(16).fill(1),
    },
  });
}

async function resultFor(
  source: Parameters<SolverAdapter<StructuralSolveInput, StructuralResult>["run"]>[0],
  complianceJ: number,
) {
  const system = await compileStructuralStudy(source);
  const cellCount = system.activeCells.length;
  const displacementM = new Float32Array(system.fixedDofs.length);
  displacementM[0] = 0.01;
  const vonMisesStressPa = new Float32Array(cellCount).fill(10);
  const output: StructuralResult = {
    truthLevel: "interactive-estimate", grid: system.grid, iterations: 4,
    complianceJ, strainEnergyJ: complianceJ / 2,
    maximumDisplacementM: 0.01, maximumVonMisesStressPa: 10,
    verification: {
      relativeResidual: 1e-6, forceBalanceErrorN: 0.01, appliedLoadN: 1000,
      wasmRelativeL2: 1e-4, realGpu: true, metadata: STRUCTURAL_VERIFICATION_METADATA,
    },
    rasterization: system.rasterization, displacementM, vonMisesStressPa,
  };
  return { output, truthLevel: output.truthLevel, artifacts: [] as never };
}

describe("WebGPU topology adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { gpu: {} });
    dependencies.filter.mockReset().mockImplementation(async (density: Float32Array) => new Float32Array(density));
    dependencies.update.mockReset().mockImplementation(async (density: Float32Array) => {
      const next = new Float32Array(density);
      for (const index of [5, 6, 9, 10, 13, 14]) {
        next[index] = Math.max(0, next[index]! - 0.3);
      }
      return next;
    });
    let compliance = 110;
    dependencies.structuralRun.mockReset().mockImplementation(async (source) => {
      compliance -= 10;
      return resultFor(source, compliance);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["reference-drone", "se6-cobot-link"])(
    "runs one general structural loop and post-extraction re-analysis for %s",
    async (jobId) => {
      const partial: unknown[] = [];
      const solved = await createWebGpuTopologyAdapter().run(
        await request(jobId), new AbortController().signal, (event) => partial.push(event),
      );

      expect(solved.truthLevel).toBe("interactive-estimate");
      expect(solved.output.density.every((value) => value >= 0 && value <= 1)).toBe(true);
      expect(solved.output.objectiveHistory).toEqual([100, 90, 80]);
      expect(solved.output.acceptance).toMatchObject({
        eligible: true, accepted: false, exportable: false,
        promotionRequired: "task-5-live-gate",
      });
      expect(solved.output.extraction).toMatchObject({ closed: true, oriented: true });
      expect(dependencies.structuralRun).toHaveBeenCalledTimes(4);
      expect(partial).toEqual(expect.arrayContaining([
        expect.objectContaining({ partial: expect.objectContaining({
          kind: "topology-objective-history", samples: [expect.objectContaining({ objectiveJ: 100 })],
        }) }),
        expect.objectContaining({ partial: expect.objectContaining({
          samples: expect.arrayContaining([expect.objectContaining({ objectiveJ: 80 })]),
        }) }),
      ]));
      expect(solved.artifacts).toHaveLength(6);
      for (const sample of solved.output.objectiveSamples) {
        expect(sample.maskDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(sample.structuralResultDigest).toMatch(/^[0-9a-f]{64}$/);
      }
      const history = solved.artifacts.find(({ record }) =>
        record.mediaType === "application/vnd.structural-evolution.topology-history-v1");
      expect(history).toBeDefined();
      const payload = history!.payload as Record<string, ArrayBufferView>;
      const shape = payload.maskShape as Uint32Array;
      const masks = payload.binaryMasks as Uint8Array;
      expect(Array.from(shape)).toEqual([3, 16]);
      for (let sampleIndex = 0; sampleIndex < shape[0]!; sampleIndex += 1) {
        const start = sampleIndex * shape[1]!;
        const activeCells = Uint32Array.from(masks.slice(start, start + shape[1]!));
        await expect(digestArtifactPayload({ activeCells }))
          .resolves.toBe(solved.output.objectiveSamples[sampleIndex]!.maskDigest);
      }
    },
  );

  it("rejects absent manufacturing constraints and non-monotonic objective history", async () => {
    expect(() => TopologyStudySchema.parse({
      id: "missing-feature", kind: "topology", sourceStudyId: "bar-static",
      configurationState: "configured", objective: "minimum-compliance",
      targetVolumeFraction: 0.75, moveLimit: 0.3, filterRadiusM: 0.01,
      maxIterations: 2, extraction: { isoValue: 0.5, toleranceM: 1e-6 },
      protectedVoidSelectionIds: [],
      acceptance: {
        maximumDisplacementM: 0.1, maximumVonMisesStressPa: 100,
        minimumSafetyFactor: 2, maximumMaterialFraction: 0.8,
      },
    })).toThrow(/minimumFeatureM/i);

    dependencies.structuralRun.mockReset()
      .mockImplementationOnce(async (source) => resultFor(source, 100))
      .mockImplementationOnce(async (source) => resultFor(source, 101));
    await expect(createWebGpuTopologyAdapter().run(
      await request("non-monotonic"), new AbortController().signal, () => undefined,
    )).rejects.toThrow(/objective history/i);
  });

  it("cancels between completed iterations while preserving emitted objective history", async () => {
    const controller = new AbortController();
    dependencies.update.mockImplementationOnce(async (density: Float32Array) => {
      controller.abort();
      return density;
    });
    const partial: Array<{ partial?: { samples?: readonly { objectiveJ: number }[] } }> = [];

    await expect(createWebGpuTopologyAdapter().run(
      await request("cancel-between-iterations"), controller.signal,
      (event) => partial.push(event as typeof partial[number]),
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(dependencies.structuralRun).toHaveBeenCalledOnce();
    expect(partial.at(-1)?.partial?.samples?.map(({ objectiveJ }) => objectiveJ)).toEqual([100]);
  });

  it("fails closed instead of substituting Wasm when WebGPU is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const adapter = createWebGpuTopologyAdapter();
    expect(adapter.supports(await request("no-webgpu"))).toMatchObject({ supported: false });
    await expect(adapter.run(
      await request("no-webgpu"), new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "unsupported-capability" });
  });

  it("rejects caller-owned optimization settings outside the revision-owned study", async () => {
    const base = await request("caller-settings");
    await expect(createWebGpuTopologyAdapter().run(
      { ...base, settings: { targetVolumeFraction: 0.1 } },
      new AbortController().signal, () => undefined,
    )).rejects.toThrow(/revision-owned/i);
    await expect(createWebGpuTopologyAdapter().run(
      { ...base, input: { ...base.input, moveLimit: 0.9 } } as never,
      new AbortController().signal, () => undefined,
    )).rejects.toThrow(/solve input/i);
    expect(dependencies.structuralRun).not.toHaveBeenCalled();
  });
});
