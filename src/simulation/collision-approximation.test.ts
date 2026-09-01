import { describe, expect, it } from "vitest";

import { compileCollisionShape } from "./collision-approximation";

const identity = { positionM: [0, 0, 0] as const, orientation: [0, 0, 0, 1] as const };
const mesh = {
  verticesM: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as const,
  triangles: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] as const,
};

describe("mechanism collision approximation", () => {
  it("uses a proven exact primitive at zero deviation", () => {
    expect(compileCollisionShape({
      bodyKind: "dynamic", toleranceM: 1e-9, mesh,
      primitive: { shape: { kind: "box", halfExtentsM: [1, 2, 3] }, bodyLocalTransform: identity },
      convexStraightExtrusion: false,
    })).toEqual({
      shape: { kind: "box", halfExtentsM: [1, 2, 3] }, bodyLocalTransform: identity,
      approximation: { kind: "exact-primitive", maximumSurfaceDeviationM: 0 },
    });
  });

  it("permits bounded convex hulls for proven convex dynamic geometry", () => {
    expect(compileCollisionShape({
      bodyKind: "dynamic", toleranceM: 1e-3, mesh,
      convexStraightExtrusion: true,
    }).shape.kind).toBe("convex-hull");
  });

  it("uses trimesh only for fixed bodies and fails unsupported dynamic geometry or tolerance", () => {
    expect(compileCollisionShape({
      bodyKind: "fixed", toleranceM: 1e-3, mesh, convexStraightExtrusion: false,
    }).shape.kind).toBe("fixed-trimesh");
    expect(() => compileCollisionShape({
      bodyKind: "dynamic", toleranceM: 1e-3, mesh, convexStraightExtrusion: false,
    })).toThrow(/unsupported.*dynamic/i);
    expect(() => compileCollisionShape({
      bodyKind: "fixed", toleranceM: 9e-5, mesh, convexStraightExtrusion: false,
    })).toThrow(/tolerance/i);
  });
});
