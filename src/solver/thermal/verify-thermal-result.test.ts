import { describe, expect, it, vi } from "vitest";

vi.mock("../../reference/pkg/webmcp_reference.js", async (importOriginal) => {
  const reference = await importOriginal<typeof import("../../reference/pkg/webmcp_reference.js")>();
  const { readFileSync } = await import("node:fs");
  const module = readFileSync("src/reference/pkg/webmcp_reference_bg.wasm");
  return { ...reference, default: async () => { reference.initSync({ module }); } };
});

import { evaluateThermalField, solveThermalReference } from "../../reference";
import type { ThermalInput, ThermalResult } from "./thermal-contract";
import { verifyThermalResult } from "./verify-thermal-result";

const grid = (length: number, conductivity: readonly number[], boundary: "fixed" | "flux"): ThermalInput => ({
  sourceRevision: "a".repeat(64), studyId: `generic-${boundary}-${length}`, bodyIds: ["domain"],
  consumedArtifactIds: ["b".repeat(64), "c".repeat(64), "d".repeat(64)],
  grid: { cellDimensions: [length, 1, 1], originM: [0, 0, 0], cellSizeM: 0.25 },
  activeCells: new Uint32Array(length).fill(1), activeCellCount: length,
  conductivityWmK: new Float32Array(conductivity),
  dirichletCells: boundary === "fixed"
    ? [{ cellIndex: 0, temperatureK: 300 }, { cellIndex: length - 1, temperatureK: 400 }]
    : [{ cellIndex: 0, temperatureK: 300 }],
  neumannFaces: boundary === "flux" ? [{
    cellIndex: length - 1, axis: 0, direction: 1, areaM2: 0.0625, heatFluxWm2: 100,
  }] : [],
  rasterization: { toleranceM: 0.001, selections: [] },
  capability: { maxCells: 1_024, maxBoundaryFaces: 1_024, maxRelativeAreaError: 0.01 },
});

const fixtures = {
  bar: grid(5, [10, 10, 10, 10, 10], "fixed"),
  wall: grid(4, [10, 10, 1, 1], "fixed"),
  mixed: grid(5, [10, 10, 10, 10, 10], "flux"),
} as const;

async function candidate(input: ThermalInput): Promise<ThermalResult> {
  const reference = await solveThermalReference(input);
  return {
    truthLevel: "interactive-estimate", grid: input.grid, iterations: -1,
    temperatureK: Float32Array.from(reference.temperatureK),
    heatFluxWm2: Float32Array.from(reference.heatFluxWm2),
    faceHeatFluxWm2: Float32Array.from(reference.faceHeatFluxWm2),
    faceAreasM2: Float32Array.from(reference.faceAreasM2),
    relativeResidual: Number.NaN, heatInputW: Number.NaN, heatOutputW: Number.NaN,
    energyImbalanceW: Number.NaN, relativeEnergyImbalance: Number.NaN,
    device: { realGpu: true, backend: "webgpu", precision: "f32", adapterInfo: {
      vendor: "untrusted", architecture: "untrusted", device: "untrusted", description: "untrusted",
    }, limits: { maxBufferSize: 1, maxStorageBufferBindingSize: 1, maxComputeWorkgroupsPerDimension: 1 } },
    rasterization: input.rasterization,
  };
}

async function withEvaluatedFields(
  input: ThermalInput, result: ThermalResult, temperatureK: Float32Array,
): Promise<ThermalResult> {
  const fields = await evaluateThermalField(input, temperatureK);
  return { ...result, temperatureK, heatFluxWm2: Float32Array.from(fields.heatFluxWm2),
    faceHeatFluxWm2: Float32Array.from(fields.faceHeatFluxWm2),
    faceAreasM2: Float32Array.from(fields.faceAreasM2) };
}

describe("verifyThermalResult", () => {
  it.each(Object.entries(fixtures))("accepts the generic %s analytical fixture", async (_name, input) => {
    const verification = await verifyThermalResult(input, await candidate(input));

    expect(verification).toMatchObject({
      verified: true, maximumTemperatureRelativeL2: 1e-3,
      maximumHeatRateRelativeError: 2e-3, maximumRelativeEnergyImbalance: 1e-3,
    });
    expect(verification.temperatureRelativeL2).toBeLessThan(1e-6);
    expect(verification.heatRateRelativeError).toBeLessThan(1e-6);
    expect(verification.relativeEnergyImbalance).toBeLessThan(1e-6);
  });

  it("rejects a candidate from a different grid", async () => {
    const result = await candidate(fixtures.bar);
    const wrong = { ...result, grid: { ...result.grid, cellDimensions: [1, 5, 1] as const } };
    await expect(verifyThermalResult(fixtures.bar, wrong)).rejects.toThrow(/grid dimensions/);
  });

  it.each(["temperatureK", "heatFluxWm2", "faceHeatFluxWm2", "faceAreasM2"] as const)(
    "rejects a non-finite %s field",
    async (field) => {
      const result = await candidate(fixtures.bar), malformed = new Float32Array(result[field]);
      malformed[0] = Number.NaN;
      await expect(verifyThermalResult(fixtures.bar, { ...result, [field]: malformed }))
        .rejects.toThrow(/finite/);
    },
  );

  it.each(["heatFluxWm2", "faceHeatFluxWm2", "faceAreasM2"] as const)(
    "rejects a finite %s field that disagrees with independent evaluation",
    async (field) => {
      const result = await candidate(fixtures.bar), malformed = new Float32Array(result[field]);
      malformed[0]! += Math.max(10, Math.abs(malformed[0]!) * 0.1);
      await expect(verifyThermalResult(fixtures.bar, { ...result, [field]: malformed }))
        .rejects.toThrow(/field disagreement/);
    },
  );

  it("rejects temperature relative L2 error above 1e-3", async () => {
    const result = await candidate(fixtures.bar);
    const temperatureK = Float32Array.from(result.temperatureK, (value) => value * 1.0011);
    await expect(verifyThermalResult(fixtures.bar, { ...result, temperatureK }))
      .rejects.toThrow(/temperature relative L2/);
  });

  it("rejects recomputed heat-rate error above 2e-3 even when temperature L2 passes", async () => {
    const result = await candidate(fixtures.bar), temperatureK = new Float32Array(result.temperatureK);
    temperatureK[1]! += 0.3; temperatureK[3]! -= 0.3;
    await expect(verifyThermalResult(fixtures.bar, await withEvaluatedFields(fixtures.bar, result, temperatureK)))
      .rejects.toThrow(/heat-rate relative error/);
  });

  it("rejects recomputed energy imbalance above 1e-3 without trusting result scalars", async () => {
    const result = await candidate(fixtures.bar), temperatureK = new Float32Array(result.temperatureK);
    temperatureK[1]! += 0.04;
    await expect(verifyThermalResult(fixtures.bar, await withEvaluatedFields(fixtures.bar, result, temperatureK)))
      .rejects.toThrow(/energy imbalance/);
  });
});
