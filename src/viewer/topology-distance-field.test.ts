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
});
