import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compileStructuralStudy } from "../structural/compile-structural-study";
import { RECORDING_GPU_GLOBALS, recordingGpu } from "../structural/recording-gpu-device";
import { structuralRequest } from "../structural/structural-test-fixtures";
import { minimumComplianceDirection, updateTopologyDensity } from "./topology-gpu";

describe("topology GPU numerical envelope", () => {
  beforeEach(() => {
    vi.stubGlobal("GPUBufferUsage", RECORDING_GPU_GLOBALS.GPUBufferUsage);
    vi.stubGlobal("GPUShaderStage", RECORDING_GPU_GLOBALS.GPUShaderStage);
    vi.stubGlobal("GPUMapMode", RECORDING_GPU_GLOBALS.GPUMapMode);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("retains material in the higher element-strain-energy region", () => {
    const direction = minimumComplianceDirection(
      new Float32Array([1, 9]), new Uint32Array([1, 1]),
    );
    expect(direction[0]).toBeLessThan(0);
    expect(direction[1]).toBeGreaterThan(0);
  });

  it("scans the full structural cell limit without spreading the sensitivity array", async () => {
    const count = 262_144;
    expect(() => minimumComplianceDirection(
      new Float32Array(count).fill(1), new Uint32Array(count).fill(1),
    )).not.toThrow();
  });

  it("does not submit the density update after cancellation between energy readback and update", async () => {
    const controller = new AbortController();
    const recorded = recordingGpu({ afterFirstReadback: () => controller.abort() });
    vi.stubGlobal("navigator", { gpu: recorded.gpu });
    const system = await compileStructuralStudy(await structuralRequest());

    await expect(updateTopologyDensity(
      new Float32Array(system.activeCells.length).fill(1),
      new Float32Array(system.fixedDofs.length), system, 0.3, controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(recorded.submitCount()).toBe(1);
    expect(recorded.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(recorded.device.destroy).toHaveBeenCalledOnce();
    expect(recorded.errorScopeDepth()).toBe(0);
  });

  it("does not submit the density update after device loss between energy readback and update", async () => {
    const recorded = recordingGpu({ loseAfterFirstReadback: true });
    vi.stubGlobal("navigator", { gpu: recorded.gpu });
    const system = await compileStructuralStudy(await structuralRequest());

    await expect(updateTopologyDensity(
      new Float32Array(system.activeCells.length).fill(1),
      new Float32Array(system.fixedDofs.length), system, 0.3, new AbortController().signal,
    )).rejects.toMatchObject({ code: "device-lost" });
    expect(recorded.submitCount()).toBe(1);
    expect(recorded.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(recorded.device.destroy).toHaveBeenCalledOnce();
    expect(recorded.errorScopeDepth()).toBe(0);
  });
});
