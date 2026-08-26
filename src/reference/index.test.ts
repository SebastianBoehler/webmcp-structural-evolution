import { beforeEach, describe, expect, it, vi } from "vitest";

const wasm = vi.hoisted(() => ({
  initialize: vi.fn<() => Promise<void>>(),
  relativeL2: vi.fn<(expected: Float32Array, actual: Float32Array) => number>(),
  optimize: vi.fn(),
}));

vi.mock("./pkg/webmcp_reference.js", () => ({
  default: wasm.initialize,
  relative_l2: wasm.relativeL2,
  optimize_demo_frame: wasm.optimize,
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
      density: new Float32Array([1, 0.6, 0, 0.4, 0.2, 1]),
      displacement: new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.42]),
      stress: new Float32Array([1, 2, 3, 4, 5, 12]),
      initial_compliance: 18,
      final_compliance: 7,
      max_displacement: 0.42,
      max_stress: 12,
      minimum_safety_factor: 4,
      material_fraction: 0.36,
      iterations: 16,
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
    const { optimizeDroneFrame } = await import("./index");

    const result = await optimizeDroneFrame("balanced");

    expect(wasm.optimize).toHaveBeenCalledWith("balanced");
    expect(result.dimensions).toEqual({ width: 3, height: 2, depth: 1 });
    expect(result.density).toBeInstanceOf(Float32Array);
    expect(result.density).toEqual(new Float32Array([1, 0.6, 0, 0.4, 0.2, 1]));
    expect(result.displacement).toHaveLength(6);
    expect(result.stress).toHaveLength(6);
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

  it("rejects invalid Wasm topology output instead of rendering it", async () => {
    const { optimizeDroneFrame } = await import("./index");
    wasm.optimize.mockReturnValueOnce({
      width: 3,
      height: 2,
      depth: 1,
      density: new Float32Array([1]),
      displacement: new Float32Array([1]),
      stress: new Float32Array([1]),
      initial_compliance: 18,
      final_compliance: Number.NaN,
      max_displacement: 0.42,
      material_fraction: 0.36,
      iterations: 16,
    });

    await expect(optimizeDroneFrame("balanced")).rejects.toThrow(/invalid topology result/i);
  });
});
