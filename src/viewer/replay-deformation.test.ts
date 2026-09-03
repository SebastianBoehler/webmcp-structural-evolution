import { expect, it } from "vitest";

import { sampleReplayDisplacement, STRUCTURAL_DEFORMATION_EXAGGERATION } from "./replay-deformation";

it("samples the nearest solved attachment cell with one shared labeled scale", () => {
  const grid = { dimensions: [2, 1, 1] as const, cellSize: [10, 10, 10] as const,
    origin: [-10, -5, -5] as const, active: new Uint8Array([1, 1]) };
  const vectors = new Float32Array([.1, 0, -.2, .3, .4, 0]);

  expect(STRUCTURAL_DEFORMATION_EXAGGERATION).toBe(1_000);
  sampleReplayDisplacement(grid, vectors, [-4, 0, 0], 10).forEach((value, axis) => {
    expect(value).toBeCloseTo([1, 0, -2][axis]!, 6);
  });
  sampleReplayDisplacement(grid, vectors, [8, 0, 0], -10).forEach((value, axis) => {
    expect(value).toBeCloseTo([-3, -4, 0][axis]!, 6);
  });
  expect(() => sampleReplayDisplacement(grid, new Float32Array(3), [0, 0, 0], 1))
    .toThrow("does not match");
});
