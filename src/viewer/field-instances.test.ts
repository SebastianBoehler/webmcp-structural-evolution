import { describe, expect, it } from "vitest";

import {
  MAX_FIELD_INSTANCES,
  visibleInstances,
  type VoxelGrid,
} from "./field-instances";

const grid: VoxelGrid = {
  dimensions: { width: 2, height: 2, depth: 2 },
  cellSize: [2, 4, 6],
  anchor: {
    position: [10, 20, 30],
    orientation: [0, 0, 0, 1],
  },
};

describe("visibleInstances", () => {
  it("thresholds without changing the source field", () => {
    const field = new Float32Array([0.2, 0.7, 0.5, 0.8, 0.1, 0.4, 0.9, 0.3]);
    const before = Array.from(field);

    const records = visibleInstances(field, grid, 0.5);

    expect(records.map(({ index, density }) => [index, density])).toEqual([
      [1, Math.fround(0.7)],
      [2, 0.5],
      [3, Math.fround(0.8)],
      [6, Math.fround(0.9)],
    ]);
    expect(Array.from(field)).toEqual(before);
  });

  it("uses a stable x-fastest index mapping and cell-center positions", () => {
    const field = new Float32Array(8);
    field[6] = 1;

    expect(visibleInstances(field, grid, 0.5)).toEqual([
      {
        index: 6,
        x: 0,
        y: 1,
        z: 1,
        localPosition: [1, 6, 9],
        density: 1,
      },
    ]);
  });

  it("rejects invalid dimensions, lengths, fields, and thresholds before extraction", () => {
    expect(() => visibleInstances(new Float32Array(7), grid, 0.5)).toThrow(/length/i);
    expect(() => visibleInstances(new Float32Array(8), grid, Number.NaN)).toThrow(/threshold/i);

    const invalidField = new Float32Array(8);
    invalidField[4] = Number.POSITIVE_INFINITY;
    expect(() => visibleInstances(invalidField, grid, 0.5)).toThrow(/field\[4\].*finite/i);

    const oversized: VoxelGrid = {
      ...grid,
      dimensions: { width: MAX_FIELD_INSTANCES + 1, height: 1, depth: 1 },
    };
    expect(() => visibleInstances(new Float32Array(0), oversized, 0.5)).toThrow(/instance budget/i);
  });

  it.each([
    ["cell size", { ...grid, cellSize: [1, 2] }],
    ["anchor position", { ...grid, anchor: { ...grid.anchor, position: [1, 2] } }],
    ["anchor orientation", { ...grid, anchor: { ...grid.anchor, orientation: [0, 0, 1] } }],
  ])("rejects a malformed %s tuple", (_name, malformed) => {
    expect(() =>
      visibleInstances(new Float32Array(8), malformed as unknown as VoxelGrid, 0.5),
    ).toThrow(/exactly/i);
  });

  it("rejects non-unit orientations and overflowing derived extents", () => {
    const scaledQuaternion: VoxelGrid = {
      ...grid,
      anchor: { ...grid.anchor, orientation: [0, 0, 0, 2] },
    };
    expect(() => visibleInstances(new Float32Array(8), scaledQuaternion, 0.5)).toThrow(
      /unit quaternion/i,
    );

    const overflowing: VoxelGrid = {
      dimensions: { width: 2, height: 1, depth: 1 },
      cellSize: [Number.MAX_VALUE, 1, 1],
      anchor: grid.anchor,
    };
    expect(() => visibleInstances(new Float32Array(2), overflowing, 0.5)).toThrow(
      /derived.*finite/i,
    );

    const rendererOverflow: VoxelGrid = {
      dimensions: { width: 1, height: 1, depth: 1 },
      cellSize: [Number.MAX_VALUE / 4, 1, 1],
      anchor: grid.anchor,
    };
    expect(() => visibleInstances(new Float32Array(1), rendererOverflow, 0.5)).toThrow(
      /derived.*finite/i,
    );
  });
});
