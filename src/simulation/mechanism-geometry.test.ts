import { describe, expect, it } from "vitest";

import { defineDesignDocument } from "../cad/document-schema";
import { mechanismDocument } from "./compile-mechanism-study.test-support";
import { assertPrimitiveDynamics, exactPrimitiveOrConvexProof } from "./mechanism-geometry";

describe("mechanism exact primitive proof", () => {
  it("rotates the collider-local cylinder Y axis onto the exact extrusion Z axis", async () => {
    const original = await mechanismDocument();
    const { revision: _revision, ...content } = original;
    const document = await defineDesignDocument({ ...content,
      sketches: content.sketches.map((sketch) => sketch.id !== "link-sketch" ? sketch : {
        ...sketch, entities: [{ id: "link-circle", kind: "circle", centerM: [0, 0], radiusM: 0.5 }],
      }),
    });
    const proof = exactPrimitiveOrConvexProof(document, "link-body");
    if (!proof.primitive || proof.primitive.shape.kind !== "cylinder") throw new Error("expected cylinder proof");
    const [x, y, z, w] = proof.primitive.bodyLocalTransform.orientation;
    const rotatedY = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
    expect(rotatedY[0]).toBeCloseTo(0, 14);
    expect(rotatedY[1]).toBeCloseTo(0, 14);
    expect(rotatedY[2]).toBeCloseTo(1, 14);
  });

  it("rejects intent-only primitive claims without matching exact topology and inertia", async () => {
    const proof = exactPrimitiveOrConvexProof(await mechanismDocument(), "link-body");
    const dynamics = { volumeM3: 1, centerOfMassM: [0, 0, 0.5] as const,
      centroidalInertiaUnitDensityKgM2: [1 / 6, 0, 0, 0, 1 / 6, 0, 0, 0, 1 / 6] as const };
    const face = (index: number) => ({ id: `face-${index}`, bodyId: "link-body",
      signature: { ownerFeatureId: "link-feature", kind: "face" as const, geometry: "plane" as const,
        centroidM: [index, 0, 0] as [number, number, number], measureSI: 1, adjacentKinds: [] },
      surfaceEvidence: { kind: "plane" as const, normal: [1, 0, 0] as [number, number, number] } });
    expect(() => assertPrimitiveDynamics(proof, dynamics, [face(0)]))
      .toThrow(/semantic topology/i);
    expect(() => assertPrimitiveDynamics(proof, {
      ...dynamics, centroidalInertiaUnitDensityKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }, Array.from({ length: 6 }, (_value, index) => face(index))))
      .toThrow(/inertia evidence/i);
  });
});
