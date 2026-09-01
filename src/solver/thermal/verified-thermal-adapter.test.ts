import { beforeEach, expect, test, vi } from "vitest";

import { createThermalAnalyticalRequest } from "./thermal-analytical-request";
import type { ThermalResult } from "./thermal-contract";
import { packInteractiveThermalResult } from "./thermal-result-artifacts";
import { createVerifiedThermalAdapter } from "./verified-thermal-adapter";

const fakes = vi.hoisted(() => ({ run: vi.fn(), verify: vi.fn() }));
vi.mock("./webgpu-thermal-adapter", () => ({
  createWebGpuThermalAdapter: () => ({ capability: { kind: "thermal" },
    supports: () => ({ supported: true }), run: fakes.run }),
}));
vi.mock("./verify-thermal-result", () => ({ verifyThermalResult: fakes.verify }));

beforeEach(() => vi.clearAllMocks());

const result = (cells: number): ThermalResult => ({
  truthLevel: "interactive-estimate", grid: {
    cellDimensions: [cells, 1, 1], originM: [0, 0, 0], cellSizeM: 1,
  }, iterations: 2, temperatureK: new Float32Array(cells).fill(300),
  heatFluxWm2: new Float32Array(cells * 3), faceHeatFluxWm2: new Float32Array(cells * 6),
  faceAreasM2: new Float32Array(cells * 6), relativeResidual: 1e-8,
  heatInputW: 0, heatOutputW: 0, energyImbalanceW: 0, relativeEnergyImbalance: 0,
  device: { realGpu: true, backend: "webgpu", precision: "f32", adapterInfo: {
    vendor: "test", architecture: "test", device: "test", description: "test",
  }, limits: { maxBufferSize: 1, maxStorageBufferBindingSize: 1,
    maxComputeWorkgroupsPerDimension: 1 } }, rasterization: { toleranceM: .01, selections: [] },
});

test("promotes only after private verification and preserves public WebGPU artifacts", async () => {
  const request = await createThermalAnalyticalRequest({
    dimensions: [2, 1, 1], cellSizeM: 1,
    bodies: [{ id: "bar", materialId: "metal", conductivityWmK: 1 }],
    cellBodyIndices: new Uint32Array(2), boundaries: [
      { id: "left", cellIndex: 0, axis: 0, direction: -1, areaM2: 1, temperatureK: 300 },
    ],
  });
  const candidate = result(2);
  const publicRun = await packInteractiveThermalResult(request, candidate);
  fakes.verify.mockResolvedValue({ verified: true as const, temperatureRelativeL2: 0,
    fieldRelativeL2: 0, heatRateRelativeError: 0, relativeEnergyImbalance: 0,
    independentlyEvaluatedHeatInputW: 0, independentlyEvaluatedHeatOutputW: 0,
    referenceIterations: 1, referenceRelativeResidual: 0,
    maximumTemperatureRelativeL2: 1e-3 as const, maximumHeatRateRelativeError: 2e-3 as const,
    maximumRelativeEnergyImbalance: 1e-3 as const });
  fakes.run.mockResolvedValue(publicRun);
  const adapter = createVerifiedThermalAdapter();

  const promoted = await adapter.run(request, new AbortController().signal, () => undefined);

  expect(fakes.verify).toHaveBeenCalledOnce();
  expect(promoted.truthLevel).toBe("converged-numerical-solve");
  expect(promoted.artifacts.slice(0, 2).map(({ record }) => record.id))
    .toEqual(publicRun.artifacts.slice(0, 2).map(({ record }) => record.id));
  expect(promoted.artifacts[2].record.id).not.toBe(publicRun.artifacts[2].record.id);
  const summary = promoted.artifacts[2].payload;
  if (summary instanceof ArrayBuffer || ArrayBuffer.isView(summary)) throw new Error("missing summary");
  expect(JSON.parse(new TextDecoder().decode(summary.evidenceUtf8 as Uint8Array)))
    .toMatchObject({ truthLevel: "converged-numerical-solve",
      verification: { verified: true, temperatureRelativeL2: 0 } });
  expect(promoted.output.verification.verified).toBe(true);
});

test("verification failure propagates without promotion or fallback", async () => {
  const request = await createThermalAnalyticalRequest({
    dimensions: [1, 1, 1], cellSizeM: 1,
    bodies: [{ id: "bar", materialId: "metal", conductivityWmK: 1 }],
    cellBodyIndices: new Uint32Array(1), boundaries: [
      { id: "left", cellIndex: 0, axis: 0, direction: -1, areaM2: 1, temperatureK: 300 },
    ],
  });
  const publicRun = await packInteractiveThermalResult(request, result(1));
  fakes.run.mockResolvedValue(publicRun);
  fakes.verify.mockRejectedValue(new Error("independent Wasm mismatch"));
  const adapter = createVerifiedThermalAdapter();

  await expect(adapter.run(request, new AbortController().signal, () => undefined))
    .rejects.toThrow("independent Wasm mismatch");
});
