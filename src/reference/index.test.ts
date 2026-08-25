import { beforeEach, describe, expect, it, vi } from "vitest";

const wasm = vi.hoisted(() => ({
  initialize: vi.fn<() => Promise<void>>(),
  relativeL2: vi.fn<(expected: Float32Array, actual: Float32Array) => number>(),
}));

vi.mock("./pkg/webmcp_reference.js", () => ({
  default: wasm.initialize,
  relative_l2: wasm.relativeL2,
}));

describe("relativeL2", () => {
  beforeEach(() => {
    vi.resetModules();
    wasm.initialize.mockReset().mockResolvedValue(undefined);
    wasm.relativeL2.mockReset().mockReturnValue(0.25);
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
});
