import { describe, expect, it } from "vitest";

import {
  validateClosedTriangleBodies, type OwnedTriangle, type Point3,
} from "./triangle-voxel-geometry";

function tetra(vertices: readonly [Point3, Point3, Point3, Point3]): OwnedTriangle[] {
  return vertices.map((opposite, excluded) => {
    const face = vertices.filter((_, index) => index !== excluded) as [Point3, Point3, Point3];
    const [a, b, c] = face;
    const cross: Point3 = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const inward = cross[0] * (opposite[0] - a[0]) + cross[1] * (opposite[1] - a[1])
      + cross[2] * (opposite[2] - a[2]);
    return { a, b: inward > 0 ? c : b, c: inward > 0 ? b : c, bodyId: "body", topologyId: "shell" };
  });
}

describe("semantic solid manifold validation", () => {
  it("rejects two closed shells joined only at a non-manifold vertex", () => {
    const origin: Point3 = [0, 0, 0];
    const triangles = [
      ...tetra([origin, [1, 0, 0], [0, 1, 0], [0, 0, 1]]),
      ...tetra([origin, [-1, 0, 0], [0, -1, 0], [0, 0, -1]]),
    ];
    expect(() => validateClosedTriangleBodies(triangles, ["body"], 1e-9))
      .toThrow(/non-manifold vertex link/i);
  });

  it("rejects zero-area facets and inward-oriented closed volume", () => {
    const outward = tetra([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const zeroArea = [...outward, {
      a: [0, 0, 0] as Point3, b: [1, 0, 0] as Point3, c: [2, 0, 0] as Point3,
      bodyId: "body", topologyId: "shell",
    }];
    expect(() => validateClosedTriangleBodies(zeroArea, ["body"], 1e-9)).toThrow(/zero-area/i);
    const inward = outward.map(({ a, b, c, ...rest }) => ({ a, b: c, c: b, ...rest }));
    expect(() => validateClosedTriangleBodies(inward, ["body"], 1e-9)).toThrow(/outward-oriented/i);
  });
});
