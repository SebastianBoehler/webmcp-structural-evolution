import { describe, expect, it } from "vitest";

import type { VoxelGrid } from "../viewer/field-instances";
import { serializeTopologyStl } from "./topology-stl";

function vertexKey(stl: DataView, offset: number): string {
  return [0, 4, 8]
    .map((delta) => stl.getFloat32(offset + delta, true).toFixed(5))
    .join(",");
}

function countUndirectedEdges(stl: DataView): Map<string, number> {
  const edgeCounts = new Map<string, number>();
  const triangles = stl.getUint32(80, true);
  for (let index = 0; index < triangles; index += 1) {
    const triangleOffset = 84 + index * 50;
    const vertices = [12, 24, 36].map((offset) => vertexKey(stl, triangleOffset + offset));
    for (const [left, right] of [[0, 1], [1, 2], [2, 0]] as const) {
      const edge = [vertices[left], vertices[right]].sort().join("|");
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
    }
  }
  return edgeCounts;
}

describe("serializeTopologyStl", () => {
  it("exports the rendered density surface as a closed manifold binary STL", () => {
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
    expect([...countUndirectedEdges(stl).values()].every((count) => count === 2)).toBe(true);
  });
});
