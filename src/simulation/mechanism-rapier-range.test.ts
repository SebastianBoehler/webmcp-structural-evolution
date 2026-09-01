import { expect, test } from "vitest";

import { rapierColliderBoundingRadius } from "./mechanism-rapier-range";

test("scans the maximum radius of a maximum-size mesh without flattening its coordinates", () => {
  const verticesM = Array.from({ length: 4_096 }, (_value, index) =>
    [index === 4_095 ? 1_000 : index % 7, 0, 0] as const);
  expect(rapierColliderBoundingRadius({ kind: "fixed-trimesh", verticesM,
    triangles: [[0, 1, 2]] })).toBe(1_000);
});
