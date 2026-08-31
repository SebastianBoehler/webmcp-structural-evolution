import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compileStructuralStudy } from "./compile-structural-study";
import { runStructuralPcg } from "./pcg";
import { createWebGpuStructuralAdapter } from "./webgpu-structural-adapter";
import { RECORDING_GPU_GLOBALS, recordingGpu } from "./recording-gpu-device";
import { structuralRequest } from "./structural-test-fixtures";

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

    const inFlightAbort = new AbortController();
    const canceled = recordingGpu({ afterFirstSubmit: () => inFlightAbort.abort() });
    vi.stubGlobal("navigator", { gpu: canceled.gpu });
    await expect(createWebGpuStructuralAdapter().run(
      await structuralRequest(), inFlightAbort.signal, () => undefined,
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(canceled.errorScopeDepth()).toBe(0);
    expect(canceled.maximumErrorScopeDepth()).toBe(3);
    expect(canceled.buffers.every(({ destroyed }) => destroyed)).toBe(true);

    const lost = recordingGpu({ loseAfterSubmit: true });
    vi.stubGlobal("navigator", { gpu: lost.gpu });
    await expect(createWebGpuStructuralAdapter().run(
      await structuralRequest(), new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "device-lost" });
    expect(lost.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(lost.errorScopeDepth()).toBe(0);

    const failed = recordingGpu({ pipelineFailure: true });
    vi.stubGlobal("navigator", { gpu: failed.gpu });
    await expect(createWebGpuStructuralAdapter().run(
      await structuralRequest(), new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "internal-error" });
    expect(failed.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(failed.errorScopeDepth()).toBe(0);

    const limited = recordingGpu({ maxBufferSize: 32 });
    vi.stubGlobal("navigator", { gpu: limited.gpu });
    await expect(createWebGpuStructuralAdapter().run(
      await structuralRequest(), new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "resource-limit" });
    expect(limited.errorScopeDepth()).toBe(0);
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
    expect([...recorded.scopedStages].sort()).toEqual([
      "allocation", "bind-group", "encode", "layout", "pipeline",
      "readback-map", "shader", "submit", "write",
    ]);
    expect(recorded.maximumErrorScopeDepth()).toBe(3);
    expect(recorded.errorScopeDepth()).toBe(0);
  });

  it.each([
    ["validation", "bind-group", "internal-error"],
    ["out-of-memory", "readback-map", "resource-limit"],
  ] as const)("contains %s errors through the full GPU scope boundary", async (scopeError, scopeErrorStage, code) => {
    const recorded = recordingGpu({ scopeError, scopeErrorStage });
    vi.stubGlobal("navigator", { gpu: recorded.gpu });

    await expect(createWebGpuStructuralAdapter().run(
      await structuralRequest(), new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code, message: expect.stringContaining(scopeError) });
    expect(recorded.uncapturedErrors).toHaveLength(0);
    expect(recorded.errorScopeDepth()).toBe(0);
    expect(recorded.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(recorded.device.destroy).toHaveBeenCalledOnce();
  });

});
