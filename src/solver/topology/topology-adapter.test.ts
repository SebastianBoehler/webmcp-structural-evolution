import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { SolverAdapter } from "../../engineering/solver-adapter";
import { TopologyStudySchema } from "../../engineering/study-schema";
import { compileStructuralStudy } from "../structural/compile-structural-study";
import { StructuralGpuError } from "../structural/structural-gpu-runtime";
import { structuralAppliedLoadMagnitude } from "../structural/structural-result-validation";
import {
  STRUCTURAL_VERIFICATION_METADATA,
  type StructuralResult,
  type StructuralSolveInput,
} from "../structural/structural-contract";
import { structuralRequest } from "../structural/structural-test-fixtures";
import { topologyScenarioRequest } from "./topology-test-fixtures";
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
    maximumDisplacementM: displacementM[0]!, maximumVonMisesStressPa: 10,
    verification: {
      relativeResidual: 1e-6, recomputedF32RelativeResidual: 1e-4,
      gpuReactionBalanceErrorN: .1, wasmForceBalanceErrorN: 0.01,
      wasmReactionN: [-1, 0, 0],
      appliedLoadN: structuralAppliedLoadMagnitude(source),
      wasmRelativeL2: 1e-4, wasmFieldStressRelativeL2: 1e-4,
      energyRelativeMismatch: 0, directRelativeResidual: 1e-4,
      refinementCount: 0, refinementPasses: [{
        kind: "initial", iterations: 4, recursiveResidual: 1e-6,
        recomputedF32Residual: 1e-4, residualScaleN: structuralAppliedLoadMagnitude(source),
        postDirectResidual: 1e-4, postBalance: 0.01, postEnergy: 0,
      }], realGpu: true, metadata: STRUCTURAL_VERIFICATION_METADATA,
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
      for (const index of [5, 6, 13, 14]) {
        next[index] = Math.max(0, next[index]! - 0.3);
      }
      return next;
    });
    let compliance = 70;
    dependencies.structuralRun.mockReset().mockImplementation(async (source) => {
      compliance += 10;
      return resultFor(source, compliance);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["drone", 50, "flight-loads", "mass-cut"],
    ["cobot", 36, "joint-load-case", "link-lightweighting"],
  ] as const)(
    "runs one general structural loop and post-extraction re-analysis for the %s geometry",
    async (scenario, cellCount, structuralStudyId, topologyStudyId) => {
      const partial: unknown[] = [];
      const scenarioRequest = await topologyScenarioRequest(scenario);
      expect(scenarioRequest.input.sourceStructuralRequest.studyId).toBe(structuralStudyId);
      expect(scenarioRequest.studyId).toBe(topologyStudyId);
      const sourceSystem = await compileStructuralStudy(scenarioRequest.input.sourceStructuralRequest);
      expect(sourceSystem.activeCells.some((value) => value === 0)).toBe(true);
      const solved = await createWebGpuTopologyAdapter().run(
        scenarioRequest, new AbortController().signal, (event) => partial.push(event),
      );

      expect(solved.truthLevel).toBe("interactive-estimate");
      expect(solved.output.density.every((value) => value >= 0 && value <= 1)).toBe(true);
      expect(solved.output.objectiveHistory).toEqual([80]);
      expect(solved.output.acceptance).toMatchObject({
        eligible: true, accepted: false, exportable: false,
        promotionRequired: "task-5-live-gate",
      });
      expect(solved.output.extraction).toMatchObject({ closed: true, oriented: true });
      expect(dependencies.structuralRun).toHaveBeenCalledTimes(2);
      expect(dependencies.update).not.toHaveBeenCalled();
      expect(partial).toEqual(expect.arrayContaining([
        expect.objectContaining({ partial: expect.objectContaining({
          kind: "topology-objective-history", samples: [expect.objectContaining({ objectiveJ: 80 })],
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
      expect(Array.from(shape)).toEqual([1, cellCount]);
      for (let sampleIndex = 0; sampleIndex < shape[0]!; sampleIndex += 1) {
        const start = sampleIndex * shape[1]!;
        const activeCells = Uint32Array.from(masks.slice(start, start + shape[1]!));
        expect(activeCells.every((value, cell) => value === 0 || sourceSystem.activeCells[cell] === 1)).toBe(true);
        await expect(digestArtifactPayload({ activeCells }))
          .resolves.toBe(solved.output.objectiveSamples[sampleIndex]!.maskDigest);
      }
    },
  );

  it("stops structural analyses at the rounded discrete material target", async () => {
    const solved = await createWebGpuTopologyAdapter().run(
      await request("discrete-progression"), new AbortController().signal, () => undefined,
    );
    const history = solved.artifacts.find(({ record }) =>
      record.mediaType === "application/vnd.structural-evolution.topology-history-v1")!;
    const payload = history.payload as Record<string, ArrayBufferView>;
    const masks = payload.binaryMasks as Uint8Array;
    const shape = payload.maskShape as Uint32Array;
    const counts = [...Array(shape[0]).keys()].map((iteration) =>
      masks.slice(iteration * shape[1]!, (iteration + 1) * shape[1]!).reduce((sum, value) => sum + value, 0));
    const hamming = (left: number, right: number) => {
      let changed = 0;
      for (let cell = 0; cell < shape[1]!; cell += 1) {
        if (masks[left * shape[1]! + cell] !== masks[right * shape[1]! + cell]) changed += 1;
      }
      return changed;
    };
    expect(counts).toEqual([16, 12]);
    expect([hamming(0, 1)]).toEqual([4]);
    expect(solved.output.objectiveSamples).toHaveLength(shape[0]!);
    expect(dependencies.structuralRun).toHaveBeenCalledTimes(3);
    expect(solved.output.materialFraction).toBe(0.75);
  });

  it("analyzes the canonical raw initial mask before filtering proposals", async () => {
    const base = await request("raw-initial-mask");
    const initialDensity = new Float32Array([
      1, 1, 1, 1, 1, 0.4, 0.4, 1, 1, 1, 1, 1, 1, 0.4, 0.4, 1,
    ]);
    dependencies.filter.mockImplementationOnce(async () => new Float32Array(16).fill(1));
    const solved = await createWebGpuTopologyAdapter().run(
      { ...base, input: { ...base.input, initialDensity } },
      new AbortController().signal, () => undefined,
    );
    const history = solved.artifacts.find(({ record }) =>
      record.mediaType === "application/vnd.structural-evolution.topology-history-v1")!;
    const payload = history.payload as Record<string, ArrayBufferView>;
    const masks = payload.binaryMasks as Uint8Array;
    expect(Array.from(masks.slice(0, 16))).toEqual(Array.from(initialDensity, (value) => value >= 0.5 ? 1 : 0));
  });

  it("rejects absent manufacturing constraints but permits physical compliance growth", async () => {
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
      .mockImplementationOnce(async (source) => resultFor(source, 101))
      .mockImplementationOnce(async (source) => resultFor(source, 102))
      .mockImplementationOnce(async (source) => resultFor(source, 103));
    await expect(createWebGpuTopologyAdapter().run(
      await request("physical-compliance"), new AbortController().signal, () => undefined,
    )).resolves.toMatchObject({ output: { objectiveHistory: [100, 101] } });
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
    expect(partial.at(-1)?.partial?.samples?.map(({ objectiveJ }) => objectiveJ)).toEqual([80]);
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
    )).rejects.toMatchObject({ code: "invalid-input", message: expect.stringMatching(/revision-owned/i) });
    await expect(createWebGpuTopologyAdapter().run(
      { ...base, input: { ...base.input, moveLimit: 0.9 } } as never,
      new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "invalid-input", message: expect.stringMatching(/solve input/i) });
    expect(dependencies.structuralRun).not.toHaveBeenCalled();
  });

  it("preserves typed WebGPU resource failures", async () => {
    const failure = new StructuralGpuError(
      "resource-limit", "Topology update exceeds the device workgroup limit",
    );
    dependencies.update.mockRejectedValueOnce(failure);
    await expect(createWebGpuTopologyAdapter().run(
      await request("resource-limit"), new AbortController().signal, () => undefined,
    )).rejects.toBe(failure);
  });
});
