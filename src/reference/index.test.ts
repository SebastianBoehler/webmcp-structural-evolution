import { beforeEach, describe, expect, it, vi } from "vitest";

const wasm = vi.hoisted(() => ({
  initialize: vi.fn<() => Promise<void>>(),
  relativeL2: vi.fn<(expected: Float32Array, actual: Float32Array) => number>(),
  optimize: vi.fn(),
  structural: vi.fn(),
  fieldEvaluation: vi.fn(),
  iterateEvaluation: vi.fn(),
}));

vi.mock("./pkg/webmcp_reference.js", () => ({
  default: wasm.initialize,
  relative_l2: wasm.relativeL2,
  optimize_demo_frame: wasm.optimize,
  optimize_assembly_frame: wasm.optimize,
  solve_structural_reference: wasm.structural,
  evaluate_structural_field: wasm.fieldEvaluation,
  evaluate_structural_iterate_f64: wasm.iterateEvaluation,
}));

describe("relativeL2", () => {
  beforeEach(() => {
    vi.resetModules();
    wasm.initialize.mockReset().mockResolvedValue(undefined);
    wasm.relativeL2.mockReset().mockReturnValue(0.25);
    wasm.optimize.mockReset().mockReturnValue({
      width: 3,
      height: 2,
      depth: 1,
      case_ids: ["hover", "roll-differential", "pitch-differential", "yaw-torsion"],
      density: new Float32Array([1, 0.6, 0, 0.4, 0.2, 1]),
      displacement: new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.42]),
      stress: new Float32Array([1, 2, 3, 4, 5, 12]),
      case_displacement: new Float32Array(24).fill(0.2),
      case_displacement_vectors_m: Float32Array.from(
        { length: 72 },
        (_value, index) => index % 3 === 0 ? -(index + 1) / 1_000 : 0,
      ),
      case_stress: new Float32Array(24).fill(3),
      initial_compliance: 18,
      final_compliance: 7,
      max_displacement: 0.42,
      max_stress: 12,
      minimum_safety_factor: 4,
      material_fraction: 0.36,
      iterations: 16,
    });
    wasm.structural.mockReset().mockReturnValue({
      displacement_m: new Float32Array(24).map((_value, index) => index === 3 ? 1e-6 : 0),
      von_mises_stress_pa: new Float32Array([1e6]),
      iterations: 12,
      relative_residual: 2e-7,
      force_balance_error_n: 1e-5,
      compliance_j: 0.001,
    });
    wasm.fieldEvaluation.mockReset().mockReturnValue({
      reaction_n: new Float64Array([-1, 0, 0]),
      von_mises_stress_pa: new Float32Array([1e6]),
      direct_relative_residual: 3e-4,
      force_balance_error_n: 1e-6, compliance_j: .001,
      strain_energy_j: .0005, energy_relative_mismatch: 1e-8,
    });
    wasm.iterateEvaluation.mockReset().mockReturnValue({
      free_residual_n: new Float64Array(24),
    });
  });

  it("lazy-loads Wasm once through a shared initialization promise", async () => {
    const { relativeL2 } = await import("./index");
    const expected = new Float32Array([1, 2]);
    const actual = new Float32Array([2, 3]);

    expect(wasm.initialize).not.toHaveBeenCalled();
    await expect(
      Promise.all([relativeL2(expected, actual), relativeL2(expected, actual)]),
    ).resolves.toEqual([0.25, 0.25]);
    expect(wasm.initialize).toHaveBeenCalledOnce();
    expect(wasm.relativeL2).toHaveBeenCalledTimes(2);
  });

  it("rejects inputs that are not exact Float32Arrays before loading Wasm", async () => {
    const { relativeL2 } = await import("./index");

    await expect(
      relativeL2([1] as unknown as Float32Array, new Float32Array([1])),
    ).rejects.toThrow("expected must be a Float32Array");
    await expect(
      relativeL2(new Float32Array([1]), new Float64Array([1]) as unknown as Float32Array),
    ).rejects.toThrow("actual must be a Float32Array");
    expect(wasm.initialize).not.toHaveBeenCalled();
  });

  it("surfaces structured Wasm errors without substituting a result", async () => {
    const { relativeL2 } = await import("./index");
    const error = Object.assign(new Error("[length-mismatch] vector lengths differ"), {
      code: "length-mismatch",
      name: "RelativeL2Error",
    });
    wasm.relativeL2.mockImplementationOnce(() => {
      throw error;
    });

    await expect(
      relativeL2(new Float32Array([1]), new Float32Array([1, 2])),
    ).rejects.toBe(error);
  });

  it("shares initialization failures and never calls the numerical export", async () => {
    const { relativeL2 } = await import("./index");
    const failure = new Error("Wasm initialization failed");
    wasm.initialize.mockRejectedValueOnce(failure);
    const expected = new Float32Array([1]);

    const results = await Promise.allSettled([
      relativeL2(expected, expected),
      relativeL2(expected, expected),
    ]);

    expect(results).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(wasm.initialize).toHaveBeenCalledOnce();
    expect(wasm.relativeL2).not.toHaveBeenCalled();
  });

  it("returns a bounded topology result from the low-level Wasm solver", async () => {
    const { optimizeTopology } = await import("./index");

    const result = await optimizeTopology("balanced");

    expect(wasm.optimize).toHaveBeenCalledWith("balanced");
    expect(result.dimensions).toEqual({ width: 3, height: 2, depth: 1 });
    expect(result.density).toBeInstanceOf(Float32Array);
    expect(result.density).toEqual(new Float32Array([1, 0.6, 0, 0.4, 0.2, 1]));
    expect(result.displacement).toHaveLength(6);
    expect(result.stress).toHaveLength(6);
    expect(result.cases["roll-differential"].stress).toEqual(new Float32Array(6).fill(3));
    expect(result.cases["roll-differential"].displacementVectorsM[0]).toBeLessThan(0);
    expect(result.cases["roll-differential"].displacementVectorsM).toHaveLength(18);
    expect(result.metrics).toEqual({
      initialCompliance: 18,
      finalCompliance: 7,
      maxDisplacement: 0.42,
      maxStress: 12,
      minimumSafetyFactor: 4,
      materialFraction: 0.36,
      iterations: 16,
    });
  });

  it("maps arbitrary assembly case IDs to their returned fields", async () => {
    wasm.optimize.mockReturnValueOnce({
      ...wasm.optimize(),
      case_ids: ["payload-down", "emergency-side"],
      case_displacement: new Float32Array(12).fill(0.2),
      case_displacement_vectors_m: new Float32Array(36).fill(-0.001),
      case_stress: new Float32Array(12).fill(3),
    });
    const { optimizeTopology } = await import("./index");

    const result = await optimizeTopology("balanced", {} as never);

    expect(Object.keys(result.cases)).toEqual(["payload-down", "emergency-side"]);
    expect(result.cases["emergency-side"]?.stress).toEqual(new Float32Array(6).fill(3));
    expect(result.cases["emergency-side"]?.displacementVectorsM).toEqual(
      new Float32Array(18).fill(-0.001),
    );
  });

  it("keeps reconstructed assembly density, metrics, and case fields aligned", async () => {
    wasm.optimize.mockReturnValueOnce({ ...wasm.optimize(), material_fraction: 3.2 / 5 });
    const { optimizeTopology } = await import("./index");

    const result = await optimizeTopology("balanced", {} as never);
    const nonVoidDensity = result.density.filter((value) => value !== 0);
    const meanDensity = nonVoidDensity.reduce((sum, value) => sum + value, 0) / nonVoidDensity.length;

    expect(result.metrics.materialFraction).toBeCloseTo(meanDensity, 5);
    for (const fields of Object.values(result.cases)) {
      expect(fields.stress).toHaveLength(result.density.length);
      expect(fields.displacementVectorsM).toHaveLength(result.density.length * 3);
    }
  });

  it("rejects invalid Wasm topology output instead of rendering it", async () => {
    const { optimizeTopology } = await import("./index");
    wasm.optimize.mockReturnValueOnce({
      width: 3,
      height: 2,
      depth: 1,
      density: new Float32Array([1]),
      displacement: new Float32Array([1]),
      stress: new Float32Array([1]),
      case_displacement: new Float32Array([1]),
      case_displacement_vectors_m: new Float32Array([1]),
      case_stress: new Float32Array([1]),
      initial_compliance: 18,
      final_compliance: Number.NaN,
      max_displacement: 0.42,
      material_fraction: 0.36,
      iterations: 16,
    });

    await expect(optimizeTopology("balanced")).rejects.toThrow(/invalid topology result/i);
  });

  it("returns independently solved bounded structural fields from Wasm", async () => {
    const { solveStructuralReference } = await import("./index");
    const input = {
      cellDimensions: [1, 1, 1] as [number, number, number], cellSizeM: 0.01,
      activeCells: new Uint32Array([1]), fixedDofs: new Uint32Array(24),
      loadsN: new Float64Array(24), youngsModulusPa: 200e9, poissonRatio: 0.3,
      maxIterations: 512, tolerance: 1e-6,
    };

    await expect(solveStructuralReference(input)).resolves.toMatchObject({
      iterations: 12, relativeResidual: 2e-7, forceBalanceErrorN: 1e-5,
      displacementM: new Float32Array(24).map((_value, index) => index === 3 ? 1e-6 : 0),
    });
    expect(wasm.structural).toHaveBeenCalledWith(input);
  });

  it("evaluates GPU displacement reaction and energy in f64 without resolving it", async () => {
    const { evaluateStructuralField } = await import("./index");
    const input = {
      cellDimensions: [1, 1, 1] as [number, number, number], cellSizeM: .01,
      activeCells: new Uint32Array([1]), fixedDofs: new Uint32Array(24),
      loadsN: new Float64Array(24), youngsModulusPa: 200e9, poissonRatio: .3,
      maxIterations: 512, tolerance: 1e-6,
    };
    const displacement = new Float32Array(24);
    await expect(evaluateStructuralField(input, displacement)).resolves.toEqual({
      reactionN: [-1, 0, 0], vonMisesStressPa: new Float32Array([1e6]),
      directRelativeResidual: 3e-4,
      forceBalanceErrorN: 1e-6, complianceJ: .001,
      strainEnergyJ: .0005, energyRelativeMismatch: 1e-8,
    });
    expect(wasm.fieldEvaluation).toHaveBeenCalledWith(input, displacement);
  });

  it("evaluates the Float64 master iterate and returns its canonical free residual", async () => {
    const { evaluateStructuralIterateF64 } = await import("./index");
    const input = {
      cellDimensions: [1, 1, 1] as [number, number, number], cellSizeM: .01,
      activeCells: new Uint32Array([1]), fixedDofs: new Uint32Array(24),
      loadsN: new Float64Array(24), youngsModulusPa: 200e9, poissonRatio: .3,
      maxIterations: 512, tolerance: 1e-6,
    };
    const master = new Float64Array(24);

    await expect(evaluateStructuralIterateF64(input, master)).resolves.toEqual({
      freeResidualN: new Float64Array(24),
    });
    expect(wasm.iterateEvaluation).toHaveBeenCalledWith(input, master);
  });

  it("rejects malformed structural field evaluator arrays", async () => {
    wasm.fieldEvaluation.mockReturnValueOnce({
      reaction_n: new Float64Array([0, 0]), von_mises_stress_pa: new Float32Array(),
      force_balance_error_n: 0, compliance_j: 0,
      strain_energy_j: 0, energy_relative_mismatch: 0,
    });
    const { evaluateStructuralField } = await import("./index");
    await expect(evaluateStructuralField({
      cellDimensions: [1, 1, 1], cellSizeM: 1, activeCells: new Uint32Array([1]),
      fixedDofs: new Uint32Array(24), loadsN: new Float64Array(24),
      youngsModulusPa: 1, poissonRatio: .3, maxIterations: 1, tolerance: 1e-5,
    }, new Float32Array(24))).rejects.toThrow(/field evaluation/i);
  });

  it("rejects a negative direct residual from the Float32 field evaluator", async () => {
    wasm.fieldEvaluation.mockReturnValueOnce({
      reaction_n: new Float64Array([0, 0, 0]), von_mises_stress_pa: new Float32Array([0]),
      direct_relative_residual: -1, force_balance_error_n: 0, compliance_j: 0,
      strain_energy_j: 0, energy_relative_mismatch: 0,
    });
    const { evaluateStructuralField } = await import("./index");
    await expect(evaluateStructuralField({
      cellDimensions: [1, 1, 1], cellSizeM: 1, activeCells: new Uint32Array([1]),
      fixedDofs: new Uint32Array(24), loadsN: new Float64Array(24),
      youngsModulusPa: 1, poissonRatio: .3, maxIterations: 1, tolerance: 1e-5,
    }, new Float32Array(24))).rejects.toThrow(/field evaluation/i);
  });

  it("rejects malformed structural reference output instead of substituting fields", async () => {
    wasm.structural.mockReturnValueOnce({
      displacement_m: new Float32Array([0]), von_mises_stress_pa: new Float32Array(),
      iterations: 0, relative_residual: Number.NaN, force_balance_error_n: 0, compliance_j: 0,
    });
    const { solveStructuralReference } = await import("./index");

    await expect(solveStructuralReference({
      cellDimensions: [1, 1, 1], cellSizeM: 1, activeCells: new Uint32Array([1]),
      fixedDofs: new Uint32Array(24), loadsN: new Float64Array(24),
      youngsModulusPa: 1, poissonRatio: 0.3, maxIterations: 1, tolerance: 1e-5,
    })).rejects.toThrow(/invalid structural reference result/i);
  });
});
