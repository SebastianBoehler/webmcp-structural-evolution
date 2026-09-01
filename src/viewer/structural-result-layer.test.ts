import { describe, expect, it } from "vitest";

import type {
  CompiledStructuralSystem,
  StructuralResult,
} from "../solver/structural/structural-contract";
import { structuralDisplacementLayer } from "./structural-result-layer";

function fixture() {
  const grid = { cellDimensions: [2, 1, 1] as const, nodeDimensions: [3, 2, 2] as const,
    originM: [.001, .002, .003] as const, cellSizeM: .01 };
  const displacementM = new Float32Array(3 * 2 * 2 * 3);
  for (let z = 0; z < 2; z += 1) for (let y = 0; y < 2; y += 1) for (let x = 0; x < 3; x += 1) {
    const node = x + 3 * (y + 2 * z);
    displacementM.set([x * .001, y * -.002, z * .003], node * 3);
  }
  const system = { grid, activeCells: new Uint32Array([1, 0]), fixedDofs: new Uint32Array(displacementM.length) } as CompiledStructuralSystem;
  const result = { grid, displacementM } as StructuralResult;
  return { system, result };
}

describe("StructuralResult semantic displacement adapter", () => {
  it("Hex8-averages signed nodal metres into owned cell-centre millimetre vectors", () => {
    const { system, result } = fixture();
    const displacementBefore = result.displacementM.slice();
    const activeBefore = system.activeCells.slice();
    const layer = structuralDisplacementLayer(result, system);

    expect(layer.dimensions).toEqual([2, 1, 1]);
    expect(layer.cellSize).toEqual([10, 10, 10]);
    expect(layer.origin).toEqual([1, 2, 3]);
    expect([...layer.vectors]).toEqual([
      expect.closeTo(.5), expect.closeTo(-1), expect.closeTo(1.5),
      expect.closeTo(1.5), expect.closeTo(-1), expect.closeTo(1.5),
    ]);
    expect(layer.values[0]).toBeCloseTo(Math.hypot(.5, -1, 1.5));
    expect(layer.values[1]).toBeCloseTo(Math.hypot(1.5, -1, 1.5));
    expect(layer).toMatchObject({ displacementUnit: "mm", sourceDisplacementUnit: "m" });
    expect(layer.vectors).not.toBe(result.displacementM);
    expect(layer.active).not.toBe(system.activeCells);
    expect(result.displacementM).toEqual(displacementBefore);
    expect(system.activeCells).toEqual(activeBefore);
  });

  it("fails closed on grid mismatch, incomplete nodal vectors, and nonfinite input", () => {
    const { system, result } = fixture();
    expect(() => structuralDisplacementLayer({ ...result,
      grid: { ...result.grid, cellSizeM: .02 } } as StructuralResult, system)).toThrow("grid");
    expect(() => structuralDisplacementLayer({ ...result,
      displacementM: result.displacementM.slice(3) } as StructuralResult, system)).toThrow("length");
    const nonfinite = result.displacementM.slice();
    nonfinite[4] = Number.NaN;
    expect(() => structuralDisplacementLayer({ ...result,
      displacementM: nonfinite } as StructuralResult, system)).toThrow("finite");
  });
});
