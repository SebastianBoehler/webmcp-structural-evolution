import { describe, expect, it } from "vitest";

import { buildTopologyDistanceField } from "./topology-distance-field";

const dimensions = { width: 3, height: 3, depth: 3 };
const index = (x: number, y: number, z: number, width = dimensions.width, height = dimensions.height) =>
  x + width * (y + height * z);

describe("topology distance field", () => {
  it("preserves occupied cells and a protected internal void", () => {
    const density = new Float32Array(5 * 5 * 3).fill(1);
    const voidIndex = index(2, 2, 1, 5, 5);
    density[voidIndex] = 0;
    const before = Array.from(density);

    const field = buildTopologyDistanceField(
      density, { width: 5, height: 5, depth: 3 }, [2, 2, 1], 0.32,
    );

    expect(field[index(0, 0, 0, 5, 5)]).toBeGreaterThan(0.5);
    expect(field[voidIndex]).toBeLessThan(0.5);
    expect(Array.from(density)).toEqual(before);
  });

  it("uses physical cell dimensions and is deterministic", () => {
    const density = new Float32Array(27);
    density[index(1, 1, 1)] = 1;

    const first = buildTopologyDistanceField(density, dimensions, [2, 2, 1], 0.32);
    const second = buildTopologyDistanceField(density, dimensions, [2, 2, 1], 0.32);

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(first[index(2, 1, 1)]).toBeLessThan(first[index(1, 1, 2)]!);
  });

  it.each([
    ["mismatched density", new Float32Array(2), dimensions, [1, 1, 1], 0.32, /does not match/],
    ["invalid dimensions", new Float32Array(27), { width: 0, height: 3, depth: 3 }, [1, 1, 1], 0.32, /positive integers/],
    ["non-finite density", Float32Array.from({ length: 27 }, (_, value) => value === 4 ? NaN : 0), dimensions, [1, 1, 1], 0.32, /must be finite/],
    ["invalid cell size", new Float32Array(27), dimensions, [1, 0, 1], 0.32, /positive finite/],
    ["invalid isolation", new Float32Array(27), dimensions, [1, 1, 1], NaN, /isolation must be finite/],
  ] as const)("rejects %s", (_label, density, grid, cellSize, isolation, message) => {
    expect(() => buildTopologyDistanceField(
      density, grid, cellSize as [number, number, number], isolation,
    )).toThrow(message);
  });

  it.each([
    ["all-solid", new Float32Array(27).fill(1)],
    ["all-void", new Float32Array(27)],
  ])("rejects an %s field with no material boundary", (_label, density) => {
    expect(() => buildTopologyDistanceField(density, dimensions, [1, 1, 1], 0.32))
      .toThrow(/requires both material and void/);
  });
});
