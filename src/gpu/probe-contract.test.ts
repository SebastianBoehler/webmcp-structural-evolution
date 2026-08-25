import { describe, expect, it } from "vitest";

import { expectedProbe, validateProbeInput } from "./probe-contract";

function probeInput(
  dimensions = { width: 32, height: 32, depth: 32 },
  values = new Float32Array(dimensions.width * dimensions.height * dimensions.depth),
) {
  return { dimensions, values };
}

describe("validateProbeInput", () => {
  it("accepts inclusive 32 cubed and 64 cubed grid bounds", () => {
    expect(() => validateProbeInput(probeInput())).not.toThrow();
    expect(() =>
      validateProbeInput(probeInput({ width: 64, height: 64, depth: 64 })),
    ).not.toThrow();
  });

  it.each([
    ["non-integer", { width: 32.5, height: 32, depth: 32 }],
    ["below the lower bound", { width: 31, height: 32, depth: 32 }],
    ["above the upper bound", { width: 32, height: 65, depth: 32 }],
  ])("rejects %s dimensions", (_case, dimensions) => {
    expect(() => validateProbeInput(probeInput(dimensions))).toThrow(
      /dimensions\.(width|height) must be an integer from 32 through 64/,
    );
  });

  it("rejects a values length that does not match the dimensions", () => {
    expect(() => validateProbeInput(probeInput(undefined, new Float32Array(1)))).toThrow(
      "values length must equal dimensions.width * dimensions.height * dimensions.depth (32768)",
    );
  });

  it("rejects values that are not an exact Float32Array", () => {
    const input = probeInput();

    expect(() =>
      validateProbeInput({ ...input, values: new Float64Array(input.values.length) }),
    ).toThrow("values must be a Float32Array");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite value %s",
    (value) => {
      const input = probeInput();
      input.values[4] = value;

      expect(() => validateProbeInput(input)).toThrow("values[4] must be finite");
    },
  );

  it("rejects values whose f32 square transform is not finite", () => {
    const input = probeInput();
    input.values[7] = 3.4028234663852886e38;

    expect(() => validateProbeInput(input)).toThrow(
      "values[7] produces a non-finite f32 probe result",
    );
  });
});

describe("expectedProbe", () => {
  it("applies the f32 transform output = input squared + 0.125", () => {
    const input = probeInput();
    input.values.set([-2, -0.5, 0, 1.5]);

    const output = expectedProbe(input);

    expect(output).toBeInstanceOf(Float32Array);
    expect(Array.from(output.slice(0, 5))).toEqual([4.125, 0.375, 0.125, 2.375, 0.125]);
    expect(output).not.toBe(input.values);
  });
});
