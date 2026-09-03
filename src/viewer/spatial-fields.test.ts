import { describe, expect, it } from "vitest";
import { fieldSamples, spatialRenderSamples } from "./spatial-fields";

it("keeps topology occupancy, scalar variation, displacement, and flux direction per cell", () => {
  const samples = fieldSamples({ dimensions: [2, 1, 1], cellSize: [1, 1, 1], origin: [0, 0, 0], active: new Uint8Array([1, 0]) }, {
    density: new Float32Array([.2, .9]), scalar: new Float32Array([10, 30]), displacement: new Float32Array([0, 0, 0, 2, 0, 0]), flux: new Float32Array([1, 0, 0, 0, 2, 0]),
  });
  expect(samples).toHaveLength(2);
  expect(samples[0]).toMatchObject({ visible: true, scalar: 10, displacement: [0, 0, 0], flux: [1, 0, 0] });
  expect(samples[1]).toMatchObject({ visible: false, scalar: 30, displacement: [2, 0, 0], flux: [0, 2, 0] });
});

describe("spatial renderer inputs", () => {
  it("keeps nonuniform scalar colors, deformation, and heat-flux direction per active cell", () => {
    const samples = spatialRenderSamples({
      dimensions: [2, 1, 1], cellSize: [2, 2, 2], origin: [10, 0, 0], active: new Uint8Array([1, 1]),
      values: new Float32Array([0, 10]), maximum: 10,
      vectorKind: "displacement-and-flux",
      displacement: new Float32Array([0, 0, 0, 3, 0, 0]), flux: new Float32Array([0, 1, 0, 0, 0, -2]),
    });
    expect(samples.map((sample) => sample.center)).toEqual([[11, 1, 1], [16, 1, 1]]);
    expect(samples.map((sample) => sample.colorValue)).toEqual([0, 1]);
    expect(samples.map((sample) => sample.fluxTo)).toEqual([[11, 2.4, 1], expect.objectContaining([16, 1, expect.closeTo(-.4)])]);
  });

  it("requires displacement authority and adds signed vectors without mutating inputs", () => {
    const values = new Float32Array([1]);
    const displacement = new Float32Array([-2, 3, -4]);
    const before = displacement.slice();
    const base = { dimensions: [1, 1, 1] as const, cellSize: [2, 2, 2] as const,
      origin: [10, 20, 30] as const, active: new Uint8Array([1]), values, maximum: 1 };

    expect(() => spatialRenderSamples({ ...base, vectorKind: "displacement" } as never))
      .toThrow("displacement vectors");
    const samples = spatialRenderSamples({ ...base, vectorKind: "displacement", displacement });
    expect(samples[0]?.center).toEqual([9, 24, 27]);
    expect(displacement).toEqual(before);
    expect(values).toEqual(new Float32Array([1]));
  });

  it("scales deformation with signed phase while color follows load magnitude", () => {
    const base = { dimensions: [1, 1, 1] as const, cellSize: [2, 2, 2] as const,
      origin: [0, 0, 0] as const, active: new Uint8Array([1]),
      values: new Float32Array([4]), maximum: 8, vectorKind: "displacement" as const,
      displacement: new Float32Array([1, -2, 0]) };

    expect(spatialRenderSamples({ ...base, scalarScale: .5, displacementScale: 3 })[0])
      .toMatchObject({ center: [4, -5, 1], colorValue: .25 });
    expect(spatialRenderSamples({ ...base, scalarScale: .5, displacementScale: -3 })[0])
      .toMatchObject({ center: [-2, 7, 1], colorValue: .25 });
  });
});
