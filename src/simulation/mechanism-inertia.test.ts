import { describe, expect, it } from "vitest";

import { combineMassProperties, diagonalizeInertia } from "./mechanism-inertia";

describe("mechanism inertia compilation", () => {
  it("combines offset source bodies with the parallel-axis theorem", () => {
    const combined = combineMassProperties([
      { massKg: 2, centerOfMassM: [-1, 0, 0], centroidalInertiaKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      { massKg: 2, centerOfMassM: [1, 0, 0], centroidalInertiaKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    ]);
    expect(combined.massKg).toBe(4);
    expect(combined.centerOfMassM).toEqual([0, 0, 0]);
    expect(combined.centroidalInertiaKgM2).toEqual([2, 0, 0, 0, 6, 0, 0, 0, 6]);
  });

  it("diagonalizes off-diagonal inertia with a right-handed stable frame", () => {
    const result = diagonalizeInertia([2, 1, 0, 1, 2, 0, 0, 0, 4]);
    expect(result.principalInertiaKgM2[0]).toBeCloseTo(1, 12);
    expect(result.principalInertiaKgM2[1]).toBeCloseTo(3, 12);
    expect(result.principalInertiaKgM2[2]).toBeCloseTo(4, 12);
    expect(Math.hypot(...result.principalInertiaFrameToBody)).toBeCloseTo(1, 14);
  });

  it("uses the body axes for a triply-degenerate tensor", () => {
    expect(diagonalizeInertia([3, 0, 0, 0, 3, 0, 0, 0, 3])).toEqual({
      principalInertiaKgM2: [3, 3, 3],
      principalInertiaFrameToBody: [0, 0, 0, 1],
    });
  });

  it("uses stable body axes for either repeated principal-value pair", () => {
    expect(diagonalizeInertia([1, 0, 0, 0, 2, 0, 0, 0, 2]).principalInertiaFrameToBody)
      .toEqual([0, 0, 0, 1]);
    expect(diagonalizeInertia([2, 0, 0, 0, 2, 0, 0, 0, 3]).principalInertiaFrameToBody)
      .toEqual([0, 0, 0, 1]);
  });

  it("is scale-stable for huge tensors and near-repeat perturbations", () => {
    const huge = diagonalizeInertia([2e300, 1e300, 0, 1e300, 2e300, 0, 0, 0, 3e300]);
    huge.principalInertiaKgM2.forEach((value, index) =>
      expect(value / 1e300).toBeCloseTo([1, 3, 3][index]!, 14));
    expect(diagonalizeInertia([1, 0, 0, 0, 1 + 1e-12, 0, 0, 0, 2]).principalInertiaFrameToBody)
      .toEqual([0, 0, 0, 1]);
  });
});
