import { describe, expect, it } from "vitest";

import type { ParametricGraph } from "../domain/component-model";
import { compileParametricGeometry } from "./parametric-geometry";

const metre = (value: number) => ({ value, unit: "m" as const });
const origin = { x: metre(0), y: metre(0), z: metre(0) };
const orientation = { roll: { value: 0, unit: "rad" as const }, pitch: { value: 0, unit: "rad" as const }, yaw: { value: 0, unit: "rad" as const } };

const motorPlateGraph: ParametricGraph = {
  nodes: [
    { kind: "box", id: "plate", center: origin, size: { x: metre(0.032), y: metre(0.032), z: metre(0.005) } },
    { kind: "cylinder", id: "hole-nw", center: { x: metre(-0.008), y: metre(-0.008), z: metre(0) }, radius: metre(0.0015), height: metre(0.008), orientation },
    { kind: "cylinder", id: "hole-ne", center: { x: metre(0.008), y: metre(-0.008), z: metre(0) }, radius: metre(0.0015), height: metre(0.008), orientation },
    { kind: "cylinder", id: "hole-se", center: { x: metre(0.008), y: metre(0.008), z: metre(0) }, radius: metre(0.0015), height: metre(0.008), orientation },
    { kind: "cylinder", id: "hole-sw", center: { x: metre(-0.008), y: metre(0.008), z: metre(0) }, radius: metre(0.0015), height: metre(0.008), orientation },
    { kind: "subtraction", id: "cut-nw", left: "plate", right: "hole-nw" },
    { kind: "subtraction", id: "cut-ne", left: "cut-nw", right: "hole-ne" },
    { kind: "subtraction", id: "cut-se", left: "cut-ne", right: "hole-se" },
    { kind: "subtraction", id: "plate-with-holes", left: "cut-se", right: "hole-sw" },
  ],
};

function countConnectedComponents(positions: Float32Array, indices: Uint32Array): number {
  const parents = Array.from({ length: positions.length / 3 }, (_, index) => index);
  const root = (index: number): number => parents[index] === index ? index : (parents[index] = root(parents[index]!));
  const join = (left: number, right: number) => { parents[root(left)] = root(right); };
  const vertexAt = new Map<string, number>();
  for (let index = 0; index < parents.length; index += 1) {
    const key = [0, 1, 2].map((axis) => Math.round(positions[index * 3 + axis]! * 10_000)).join(":");
    const existing = vertexAt.get(key);
    if (existing === undefined) vertexAt.set(key, index);
    else join(index, existing);
  }
  for (let index = 0; index < indices.length; index += 3) {
    join(indices[index]!, indices[index + 1]!);
    join(indices[index + 1]!, indices[index + 2]!);
  }
  return new Set(parents.map((_, index) => root(index))).size;
}

function graphWithNodes(count: number): ParametricGraph {
  return { nodes: Array.from({ length: count }, (_, index) => ({
    kind: "box" as const,
    id: `box-${index}`,
    center: origin,
    size: { x: metre(0.001), y: metre(0.001), z: metre(0.001) },
  })) };
}

describe("compileParametricGeometry", () => {
  it("subtracts a four-hole motor pattern from a bounded plate", async () => {
    const mesh = await compileParametricGeometry(motorPlateGraph);

    expect(mesh.sizeMm).toEqual([32, 32, 5]);
    expect(mesh.surfaces).toHaveLength(1);
    expect(countConnectedComponents(mesh.surfaces[0]!.positions, mesh.surfaces[0]!.indices)).toBe(1);
  });

  it("rejects graphs over the operation budget before geometry execution", async () => {
    await expect(compileParametricGeometry(graphWithNodes(257))).rejects.toThrow("256 operations");
  });

  it.each([
    ["duplicate node IDs", { nodes: [motorPlateGraph.nodes[0], { ...motorPlateGraph.nodes[0] }] }],
    ["dangling references", { nodes: [{ kind: "transform", id: "copy", source: "missing", transform: { position: origin, orientation } }] }],
    ["cycles", { nodes: [{ kind: "transform", id: "a", source: "b", transform: { position: origin, orientation } }, { kind: "transform", id: "b", source: "a", transform: { position: origin, orientation } }] }],
    ["multiple solid roots", { nodes: [motorPlateGraph.nodes[0], motorPlateGraph.nodes[1]] }],
  ] as const)("rejects %s", async (_, graph) => {
    await expect(compileParametricGeometry(graph)).rejects.toThrow();
  });
});
