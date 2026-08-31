import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareSolverRunResult } from "../../engineering/job-runner-result";
import { compileStructuralStudy } from "./compile-structural-study";
import { runStructuralPcg } from "./pcg";
import {
  createStructuralRunResult,
  createWebGpuStructuralAdapter,
} from "./webgpu-structural-adapter";
import { RECORDING_GPU_GLOBALS, recordingGpu } from "./recording-gpu-device";
import { structuralRequest } from "./structural-test-fixtures";
import type { StructuralResult } from "./structural-contract";

describe("WebGPU structural adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("GPUBufferUsage", RECORDING_GPU_GLOBALS.GPUBufferUsage);
    vi.stubGlobal("GPUShaderStage", RECORDING_GPU_GLOBALS.GPUShaderStage);
    vi.stubGlobal("GPUMapMode", RECORDING_GPU_GLOBALS.GPUMapMode);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fails closed when WebGPU is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const adapter = createWebGpuStructuralAdapter();

    expect(adapter.supports(await structuralRequest())).toMatchObject({
      supported: false,
      error: { code: "unsupported-capability", limit: { kind: "precision" } },
    });
  });

  it("dispatches distinct elasticity, vector, dot, and reduction kernels but never trusts a recording device", async () => {
    const recorded = recordingGpu();
    vi.stubGlobal("navigator", { gpu: recorded.gpu });
    const adapter = createWebGpuStructuralAdapter();

    await expect(adapter.run(
      await structuralRequest(), new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "diverged" });
    expect(recorded.dispatches).toEqual(expect.arrayContaining([
      "build_diagonal", "initialize_pcg", "apply_elasticity", "dot_product", "reduce_sum",
    ]));
    expect(recorded.buffers.length).toBeGreaterThan(8);
    expect(recorded.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(recorded.device.destroy).toHaveBeenCalledOnce();
  });

  it("distinguishes cancellation, device loss, and pipeline failure while releasing resources", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const first = recordingGpu();
    vi.stubGlobal("navigator", { gpu: first.gpu });
    await expect(createWebGpuStructuralAdapter().run(
      await structuralRequest(), aborted.signal, () => undefined,
    )).rejects.toMatchObject({ name: "AbortError" });

    const lost = recordingGpu({ loseAfterSubmit: true });
    vi.stubGlobal("navigator", { gpu: lost.gpu });
    await expect(createWebGpuStructuralAdapter().run(
      await structuralRequest(), new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "device-lost" });
    expect(lost.buffers.every(({ destroyed }) => destroyed)).toBe(true);

    const failed = recordingGpu({ pipelineFailure: true });
    vi.stubGlobal("navigator", { gpu: failed.gpu });
    await expect(createWebGpuStructuralAdapter().run(
      await structuralRequest(), new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "internal-error" });
    expect(failed.buffers.every(({ destroyed }) => destroyed)).toBe(true);

    const limited = recordingGpu({ maxBufferSize: 32 });
    vi.stubGlobal("navigator", { gpu: limited.gpu });
    await expect(createWebGpuStructuralAdapter().run(
      await structuralRequest(), new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "resource-limit" });
  });

  it("maps compiler integrity failures to typed invalid-input before GPU acquisition", async () => {
    const recorded = recordingGpu();
    vi.stubGlobal("navigator", { gpu: recorded.gpu });
    const request = await structuralRequest();
    request.input.voxelPayload.activeCells[0] = 0;

    await expect(createWebGpuStructuralAdapter().run(
      request, new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "invalid-input", message: expect.stringContaining("content digest") });
    expect(recorded.gpu.requestAdapter).not.toHaveBeenCalled();
  });

  it("records a padded multi-iteration PCG recurrence without treating it as numerical evidence", async () => {
    const recorded = recordingGpu({
      scalarSequence: [
        1, 1, 1, // rhs norm, r.z, p.Ap
        0.25, 0.5, // first residual, next r.z
        1, 0, // second p.Ap and converged residual
        -1000, 0, 0, // reaction components
        0.001, // compliance
      ],
    });
    const request = await structuralRequest();
    const compiled = await compileStructuralStudy(request);

    const solve = await runStructuralPcg(
      recorded.device as unknown as GPUDevice,
      compiled,
      new AbortController().signal,
      () => undefined,
    );

    expect(compiled.fixedDofs.length % 64).not.toBe(0);
    expect(solve).toMatchObject({ iterations: 2, relativeResidual: 0 });
    expect(solve.forceBalanceErrorN).toBeLessThan(1e-3);
    const precondition = recorded.dispatches.indexOf("apply_preconditioner");
    const direction = recorded.dispatches.indexOf("update_direction");
    expect(precondition).toBeGreaterThan(-1);
    expect(direction).toBeGreaterThan(precondition);
    expect(recorded.dispatches.filter((entry) => entry === "apply_elasticity").length).toBeGreaterThan(1);
    expect(solve).not.toHaveProperty("truthLevel");
  });

  it("packs result and field artifacts with complete study, geometry, and selection ownership", async () => {
    const request = await structuralRequest();
    const result = structuralResult();
    const envelope = await createStructuralRunResult(request, result);
    const prepared = await prepareSolverRunResult(request, envelope);

    expect(envelope.artifacts).toHaveLength(3);
    const requiredEntities = [
      "study:bar-static", "material:steel", "body:bar",
      "named-selection:fixed-end", "named-selection:loaded-end",
    ];
    for (const { record } of prepared.artifacts) {
      const entities = record.dependencies.flatMap((dependency) =>
        dependency.kind === "entity" ? [dependency.reference] : []);
      const artifacts = record.dependencies.flatMap((dependency) =>
        dependency.kind === "artifact" ? [dependency.artifactId] : []);
      expect(entities).toEqual(expect.arrayContaining(requiredEntities));
      expect(artifacts).toEqual(expect.arrayContaining(resultArtifactInputs(request)));
    }
    expect(prepared.truthLevel).toBe("interactive-estimate");
    expect(result.verification).toMatchObject({ numericalGatesPassed: true, passed: false });
  });

  it("cannot promote numerical orchestration evidence without an analytical real-GPU gate", async () => {
    const request = await structuralRequest();
    const result = structuralResult();

    await expect(createStructuralRunResult(request, {
      ...result,
      truthLevel: "converged-numerical-solve",
    })).rejects.toThrow(/analytical verification/i);
  });
});

function resultArtifactInputs(request: Awaited<ReturnType<typeof structuralRequest>>): string[] {
  return [request.input.semanticMeshArtifactId, request.input.voxelArtifactId];
}

function structuralResult(): StructuralResult {
  return {
    truthLevel: "interactive-estimate",
    grid: {
      cellDimensions: [4, 2, 2], nodeDimensions: [5, 3, 3], originM: [0, 0, 0], cellSizeM: 0.01,
    },
    iterations: 12, complianceJ: 0.01, strainEnergyJ: 0.005,
    maximumDisplacementM: 1e-6, maximumVonMisesStressPa: 2e6,
    verification: {
      relativeResidual: 1e-6, forceBalanceErrorN: 1e-6, appliedLoadN: 1000,
      wasmRelativeL2: 1e-4, numericalGatesPassed: true, passed: false, realGpu: true,
    },
    rasterization: {
      toleranceM: 1e-6,
      selections: [
        { selectionId: "fixed-end", topologyId: "face:bar:fixed", cellCount: 4, nodeCount: 9, cellHash: "a".repeat(64), nodeHash: "b".repeat(64) },
        { selectionId: "loaded-end", topologyId: "face:bar:loaded", cellCount: 4, nodeCount: 9, cellHash: "c".repeat(64), nodeHash: "d".repeat(64) },
      ],
    },
    displacementM: new Float32Array(135), vonMisesStressPa: new Float32Array(16),
  };
}
