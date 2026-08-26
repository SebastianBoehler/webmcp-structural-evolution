import { describe, expect, it } from "vitest";

import type { VoxelGrid } from "../viewer/field-instances";
import { serializeTopologyStl } from "./topology-stl";

describe("serializeTopologyStl", () => {
  it("exports the rendered density surface as a non-empty binary STL", () => {
    const grid: VoxelGrid = {
      dimensions: { width: 5, height: 5, depth: 5 },
      cellSize: [2, 2, 2],
      anchor: { position: [-5, -5, -5], orientation: [0, 0, 0, 1] },
    };
    const density = new Float32Array(125);
    for (let z = 1; z < 4; z += 1) for (let y = 1; y < 4; y += 1) {
      for (let x = 1; x < 4; x += 1) density[x + 5 * (y + 5 * z)] = 1;
    }

    const stl = serializeTopologyStl(grid, density);
    expect(stl.byteLength).toBeGreaterThan(84);
    expect(stl.getUint32(80, true)).toBeGreaterThan(0);
  });
});
