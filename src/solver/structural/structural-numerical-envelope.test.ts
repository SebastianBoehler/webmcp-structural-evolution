import { describe, expect, it } from "vitest";

import { compileStructuralStudy } from "./compile-structural-study";
import { structuralRequest } from "./structural-test-fixtures";

const LOADED_FACE_NODES = [4, 9, 14, 19, 24, 29, 34, 39, 44];

describe("structural numerical envelope", () => {
  it("keeps collinear restraint rank invariant under a large finite translation", async () => {
    const selectionNodeOffsets = new Uint32Array([0, 3, 12]);
    const selectionNodeIndices = new Uint32Array([0, 20, 40, ...LOADED_FACE_NODES]);
    await expect(compileStructuralStudy(await structuralRequest({
      selectionNodeOffsets, selectionNodeIndices,
    }))).rejects.toThrow(/rigid restraint rank 5.*less than 6/i);

    await expect(compileStructuralStudy(await structuralRequest({
      originM: new Float64Array([0, 1e20, 1e16]),
      cellSizeM: new Float64Array([9000, 9000, 9000]),
      selectionNodeOffsets,
      selectionNodeIndices,
    }))).rejects.toThrow(/rigid restraint rank 5.*less than 6/i);
  });

  it.each([
    { cellSizeM: 1e38, toleranceM: 1e-6, failure: "stiffness overflow" },
    { cellSizeM: 1e30, toleranceM: 1e-6, failure: "material-size stiffness product overflow" },
    { cellSizeM: 1e-44, toleranceM: 1e-46, failure: "stress-gradient reciprocal overflow" },
  ])("rejects $failure before GPU dispatch", async ({ cellSizeM, toleranceM }) => {
    await expect(compileStructuralStudy(await structuralRequest({
      cellSizeM: new Float64Array([cellSizeM, cellSizeM, cellSizeM]),
      rasterizationToleranceM: new Float64Array([toleranceM]),
    }))).rejects.toThrow(/derived structural operator.*finite f32/i);
  });
});
