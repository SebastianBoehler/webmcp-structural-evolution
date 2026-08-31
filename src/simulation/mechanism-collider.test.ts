import { describe, expect, it } from "vitest";

import { revisionId } from "../domain/revisions";
import { defineMechanismCollider, MechanismColliderSchema } from "./mechanism-collider";

const digest = (character: string) => character.repeat(64);
const transform = { positionM: [0, 0, 0] as const, orientation: [0, 0, 0, 1] as const };

async function candidate(bodyId = "link-instance", sourceBodyId = "link-design") {
  const payload = {
    bodyLocalTransform: transform,
    approximation: { kind: "convex-hull" as const, maximumSurfaceDeviationM: 0.0001 },
    shape: { kind: "convex-hull" as const, verticesM: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  };
  return {
    id: "link-collider", bodyId, sourceBodyId, sourceArtifactIds: [digest("b"), digest("a")],
    ...payload, geometryDigest: await revisionId(payload), membershipMask: 1, filterMask: 1,
  };
}

describe("mechanism collider contract", () => {
  it("issues canonical unverified geometry without claiming exact-CAD authority", async () => {
    await expect(defineMechanismCollider(await candidate(), {
      bodyKind: "dynamic", expectedBodyId: "link-instance", expectedSourceBodyId: "link-design",
    })).resolves.toMatchObject({
      truthLevel: "unverified-collider-input",
      sourceArtifactIds: [digest("a"), digest("b")],
      bodyLocalTransform: transform,
      approximation: { kind: "convex-hull", maximumSurfaceDeviationM: 0.0001 },
    });
  });

  it("admits only canonical unverified colliders issued by the async constructor", async () => {
    const defined = await defineMechanismCollider(await candidate(), {
      bodyKind: "dynamic",
    });
    expect(MechanismColliderSchema.safeParse(defined).success).toBe(true);
    expect(MechanismColliderSchema.safeParse({ ...defined }).success).toBe(false);
  });

  it("rejects a forged geometry digest, empty source provenance, and caller artifact claims", async () => {
    const valid = await candidate();
    await expect(defineMechanismCollider({
      ...valid, shape: { kind: "sphere", radiusM: 0.2 },
      approximation: { kind: "exact-primitive", maximumSurfaceDeviationM: 0 },
    }, { bodyKind: "dynamic" })).rejects.toThrow("Collider geometry digest does not match canonical geometry");
    await expect(defineMechanismCollider({ ...valid, sourceArtifactIds: [] }, {
      bodyKind: "dynamic",
    })).rejects.toThrow();
    await expect(defineMechanismCollider({ ...valid, artifact: { id: digest("f") } }, {
      bodyKind: "dynamic",
    })).rejects.toThrow();
    await expect(defineMechanismCollider(await candidate("base-instance", "base-design"), {
      bodyKind: "dynamic", expectedBodyId: "link-instance",
    })).rejects.toThrow("Collider body does not match its input body binding");
  });

  it("requires exact primitive approximation error to be exactly zero metres", async () => {
    const valid = await candidate();
    await expect(defineMechanismCollider({
      ...valid,
      approximation: { kind: "exact-primitive", maximumSurfaceDeviationM: 0.0001 },
      shape: { kind: "sphere", radiusM: 0.2 },
      geometryDigest: undefined,
    }, { bodyKind: "fixed" })).rejects.toThrow("Exact primitive collider deviation must be zero metres");
  });

  it("bounds hull and trimesh payloads and forbids a dynamic fixed trimesh", async () => {
    const valid = await candidate();
    await expect(defineMechanismCollider({
      ...valid,
      approximation: { kind: "convex-hull", maximumSurfaceDeviationM: 0.001 },
      shape: { kind: "convex-hull", verticesM: Array.from({ length: 257 }, (_, index) => [index, 0, 0]) },
    }, { bodyKind: "fixed" })).rejects.toThrow();
    await expect(defineMechanismCollider({
      ...valid,
      approximation: { kind: "fixed-trimesh", maximumSurfaceDeviationM: 0.001 },
      shape: { kind: "fixed-trimesh", verticesM: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2]] },
    }, { bodyKind: "dynamic" }))
      .rejects.toThrow("Dynamic mechanism bodies cannot use fixed trimesh colliders");
    await expect(defineMechanismCollider({
      ...valid,
      shape: { kind: "convex-hull", verticesM: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]] },
    }, { bodyKind: "fixed" })).rejects.toThrow("Convex hull vertices must span a volume");
    await expect(defineMechanismCollider({
      ...valid,
      approximation: { kind: "fixed-trimesh", maximumSurfaceDeviationM: 0.001 },
      shape: { kind: "fixed-trimesh", verticesM: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], triangles: [[0, 1, 2]] },
    }, { bodyKind: "fixed" })).rejects.toThrow("Collider triangle must have nonzero geometric area");
  });

  it("canonicalizes signed-zero triangle indices before deriving geometry identity", async () => {
    const valid = await candidate();
    const collider = await defineMechanismCollider({
      ...valid,
      approximation: { kind: "fixed-trimesh", maximumSurfaceDeviationM: 0.001 },
      shape: {
        kind: "fixed-trimesh", verticesM: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        triangles: [[-0, 1, 2]],
      },
      geometryDigest: undefined,
    }, { bodyKind: "fixed" });
    expect(collider.shape.kind).toBe("fixed-trimesh");
    if (collider.shape.kind !== "fixed-trimesh") throw new Error("expected fixed trimesh");
    expect(Object.is(collider.shape.triangles[0]?.[0], -0)).toBe(false);
  });
});
