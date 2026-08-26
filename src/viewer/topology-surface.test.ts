import { describe, expect, it } from "vitest";

import { smoothTopologyDensity } from "./topology-surface";

describe("topology surface preparation", () => {
  it("creates a continuous display field without mutating solver evidence", () => {
    const density = new Float32Array(27).fill(0.02);
    density[13] = 1;
    const before = Array.from(density);
    const smoothed = smoothTopologyDensity(density, { width: 3, height: 3, depth: 3 });
    expect(Array.from(density)).toEqual(before);
    expect(smoothed[13]).toBeLessThan(1);
    expect(smoothed[12]).toBeGreaterThan(0);
    expect(smoothed[4]).toBeGreaterThan(0);
    expect(smoothed[13]).toBeGreaterThan(smoothed[0]!);
  });

  it("does not smooth material across a protected through-void", () => {
    const density = new Float32Array(27).fill(1);
    density[13] = 0;
    const smoothed = smoothTopologyDensity(density, { width: 3, height: 3, depth: 3 });
    expect(smoothed[13]).toBe(0);
    expect(smoothed[12]).toBeLessThan(1);
  });
});
