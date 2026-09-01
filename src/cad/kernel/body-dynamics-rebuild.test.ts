import { OcctKernel } from "occt-wasm";
import { describe, expect, it, vi } from "vitest";

import { defineDesignDocument } from "../document-schema";
import { createOcctBridge } from "./occt-bridge";
import { rebuildDocument } from "./feature-rebuild";

async function twoBodyDocument() {
  return defineDesignDocument({
    id: "two-body", label: "Two exact bodies", schemaVersion: 4,
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "agent", id: "test" },
    frames: [{
      id: "world", label: "World",
      transform: {
        position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
        orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
      },
    }],
    parameters: [],
    sketches: [
      {
        id: "wide-sketch", plane: "frame:world",
        entities: [{ id: "wide-outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.04, 0.02] }],
        constraints: [
          { id: "wide-width", kind: "distance", first: { entityId: "wide-outline", point: "left" }, second: { entityId: "wide-outline", point: "right" }, axis: "x", valueM: 0.04 },
          { id: "wide-height", kind: "distance", first: { entityId: "wide-outline", point: "bottom" }, second: { entityId: "wide-outline", point: "top" }, axis: "y", valueM: 0.02 },
        ],
      },
      {
        id: "small-sketch", plane: "frame:world",
        entities: [{ id: "small-outline", kind: "rectangle", centerM: [0.08, 0], sizeM: [0.01, 0.01] }],
        constraints: [
          { id: "small-width", kind: "distance", first: { entityId: "small-outline", point: "left" }, second: { entityId: "small-outline", point: "right" }, axis: "x", valueM: 0.01 },
          { id: "small-height", kind: "distance", first: { entityId: "small-outline", point: "bottom" }, second: { entityId: "small-outline", point: "top" }, axis: "y", valueM: 0.01 },
        ],
      },
    ],
    features: [
      { id: "wide-feature", kind: "extrude", sketchId: "wide-sketch", distanceM: 0.01 },
      { id: "small-feature", kind: "extrude", sketchId: "small-sketch", distanceM: 0.02 },
    ],
    bodies: [
      { id: "z-wide-body", featureId: "wide-feature" },
      { id: "a-small-body", featureId: "small-feature" },
    ],
    components: [], instances: [], mates: [], namedSelections: [], materials: [], studies: [],
  });
}

describe("exact OCCT per-body dynamics rebuild", () => {
  it("emits ordered non-aggregate BREP and mass tensors while exact handles are live", async () => {
    const bridge = createOcctBridge(await OcctKernel.init());
    try {
      const payload = await rebuildDocument(
        bridge, await twoBodyDocument(), ["brep", "semantic-mesh", "body-dynamics"],
        new AbortController().signal,
      );

      expect(payload.bodyDynamics?.bodies.map(({ bodyId }) => bodyId))
        .toEqual(["a-small-body", "z-wide-body"]);
      expect(payload.bodyDynamics?.bodies.map(({ volumeM3 }) => volumeM3))
        .toEqual([expect.closeTo(0.000002, 12), expect.closeTo(0.000008, 12)]);
      expect(payload.bodyDynamics?.bodies[0]?.brep.bytes.byteLength).toBeGreaterThan(100);
      expect(payload.bodyDynamics?.bodies[1]?.brep.bytes.byteLength).toBeGreaterThan(100);
      expect(payload.bodyDynamics?.bodies[0]?.centroidalInertiaUnitDensityKgM2)
        .not.toEqual(payload.bodyDynamics?.bodies[1]?.centroidalInertiaUnitDensityKgM2);
      expect(payload.bodyDynamics?.bodies[0]?.centerOfMassM)
        .toEqual([expect.closeTo(0.08, 12), expect.closeTo(0, 12), expect.closeTo(0.01, 12)]);
      expect(payload.bodyDynamics?.bodies[0]?.centroidalInertiaUnitDensityKgM2)
        .toEqual([
          expect.closeTo(8.333333333333334e-11, 18), expect.closeTo(0, 20), expect.closeTo(0, 20),
          expect.closeTo(0, 20), expect.closeTo(8.333333333333334e-11, 18), expect.closeTo(0, 20),
          expect.closeTo(0, 20), expect.closeTo(0, 20), expect.closeTo(3.3333333333333335e-11, 18),
        ]);
      expect(bridge.withKernel(({ shapeCount }) => shapeCount)).toBe(0);
    } finally {
      bridge.dispose();
    }
  });

  it("cancels before and between per-body extraction without returning a partial payload", async () => {
    const bridge = createOcctBridge(await OcctKernel.init());
    try {
      const before = new AbortController();
      before.abort();
      await expect(rebuildDocument(
        bridge, await twoBodyDocument(), ["body-dynamics"], before.signal,
      )).rejects.toMatchObject({ name: "AbortError" });

      const during = new AbortController();
      const spy = vi.spyOn(bridge.withKernel((kernel) => kernel), "toBREPBinary")
        .mockImplementationOnce(function (this: OcctKernel, shape) {
          const bytes = OcctKernel.prototype.toBREPBinary.call(this, shape);
          setTimeout(() => during.abort(), 0);
          return bytes;
        });
      await expect(rebuildDocument(
        bridge, await twoBodyDocument(), ["body-dynamics"], during.signal,
      )).rejects.toMatchObject({ name: "AbortError" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(bridge.withKernel(({ shapeCount }) => shapeCount)).toBe(0);
    } finally {
      bridge.dispose();
    }
  });
});
