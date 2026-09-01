import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThermalInput } from "../solver/thermal/thermal-contract";

const wasm = vi.hoisted(() => ({
  initialize: vi.fn<() => Promise<void>>(),
  solve: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock("./pkg/webmcp_reference.js", () => ({
  default: wasm.initialize,
  solve_thermal_reference_wasm: wasm.solve,
  evaluate_thermal_field_wasm: wasm.evaluate,
}));

const input: ThermalInput = {
  sourceRevision: "a".repeat(64), studyId: "thermal-lifecycle", bodyIds: ["body"],
  consumedArtifactIds: ["b".repeat(64), "c".repeat(64), "d".repeat(64)],
  grid: { cellDimensions: [1, 1, 1], originM: [0, 0, 0], cellSizeM: 1 },
  activeCells: new Uint32Array([1]), activeCellCount: 1,
  conductivityWmK: new Float32Array([1]),
  dirichletCells: [{ cellIndex: 0, temperatureK: 300 }], neumannFaces: [],
  rasterization: { toleranceM: 0.01, selections: [] },
  capability: { maxCells: 1, maxBoundaryFaces: 1, maxRelativeAreaError: 0.01 },
};

function fields(free = vi.fn()) {
  return {
    heat_flux_wm2: new Float64Array(3), face_heat_flux_wm2: new Float64Array(6),
    face_areas_m2: new Float64Array(6), heat_input_w: 0, heat_output_w: 0,
    relative_energy_imbalance: 0, free,
  };
}

describe("thermal Wasm result lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    wasm.initialize.mockReset().mockResolvedValue(undefined);
    wasm.solve.mockReset();
    wasm.evaluate.mockReset();
  });

  it("frees solved reference storage exactly once after copying fields", async () => {
    const free = vi.fn();
    wasm.solve.mockReturnValue({ ...fields(free), temperature_k: new Float64Array([300]),
      iterations: 0, relative_residual: 0 });
    const { solveThermalReference } = await import("./index");
    await expect(solveThermalReference(input)).resolves.toMatchObject({ temperatureK: new Float64Array([300]) });
    expect(free).toHaveBeenCalledOnce();
  });

  it("frees solved reference storage when a getter throws", async () => {
    const free = vi.fn(), result = { ...fields(free), iterations: 0, relative_residual: 0 };
    Object.defineProperty(result, "temperature_k", { get: () => { throw new Error("getter failed"); } });
    wasm.solve.mockReturnValue(result);
    const { solveThermalReference } = await import("./index");
    await expect(solveThermalReference(input)).rejects.toThrow("getter failed");
    expect(free).toHaveBeenCalledOnce();
  });

  it("frees evaluated field storage exactly once after copying fields", async () => {
    const free = vi.fn();
    wasm.evaluate.mockReturnValue(fields(free));
    const { evaluateThermalField } = await import("./index");
    await expect(evaluateThermalField(input, new Float32Array([300]))).resolves.toMatchObject({ heatInputW: 0 });
    expect(free).toHaveBeenCalledOnce();
  });

  it("frees evaluated field storage when a getter throws", async () => {
    const free = vi.fn(), result = fields(free);
    Object.defineProperty(result, "heat_flux_wm2", { get: () => { throw new Error("getter failed"); } });
    wasm.evaluate.mockReturnValue(result);
    const { evaluateThermalField } = await import("./index");
    await expect(evaluateThermalField(input, new Float32Array([300]))).rejects.toThrow("getter failed");
    expect(free).toHaveBeenCalledOnce();
  });
});
