import { OcctKernel } from "occt-wasm";
import { describe, expect, it } from "vitest";

import { defineDesignDocument } from "../document-schema";
import { createOcctBridge } from "./occt-bridge";
import { rebuildDocument } from "./feature-rebuild";
import { importStepBytes } from "./step-exchange";

async function plateDocument(widthM = 0.08) {
  return defineDesignDocument({
    id: "exact-plate",
    label: "Exact plate",
    schemaVersion: 1,
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "agent", id: "test" },
    frames: [{
      id: "world", label: "World",
      transform: {
        position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
        orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
      },
    }],
    parameters: [{
      id: "plate-width", label: "Plate width",
      value: { kind: "length", value: { value: widthM, unit: "m" } },
    }],
    sketches: [{
      id: "plate-sketch", plane: "frame:world",
      entities: [{
        id: "plate-outline", kind: "rectangle", centerM: [0, 0],
        sizeM: [{ parameterId: "plate-width" }, 0.04],
      }],
      constraints: [],
    }],
    features: [{ id: "plate", kind: "extrude", sketchId: "plate-sketch", distanceM: 0.01 }],
    bodies: [{ id: "plate-body", featureId: "plate" }],
    components: [], instances: [], mates: [], namedSelections: [],
  });
}

async function mechanicalPartDocument(widthM = 0.08) {
  const plate = await plateDocument(widthM);
  const content = structuredClone(plate) as Record<string, unknown>;
  delete content.revision;
  return defineDesignDocument({
    ...content,
    id: "mechanical-part",
    label: "Plate with revolved boss and through cut",
    frames: [
      plate.frames[0],
      {
        id: "boss-frame", label: "Vertical boss profile", parentId: "world",
        transform: {
          position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0.01, unit: "m" } },
          orientation: { roll: { value: Math.PI / 2, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
        },
      },
    ],
    sketches: [
      plate.sketches[0],
      {
        id: "boss-sketch", plane: "frame:boss-frame",
        entities: [{ id: "boss-profile", kind: "rectangle", centerM: [0.005, 0.005], sizeM: [0.01, 0.01] }],
        constraints: [],
      },
      {
        id: "hole-sketch", plane: "frame:world",
        entities: [{ id: "hole-profile", kind: "circle", centerM: [0, 0], radiusM: 0.003 }],
        constraints: [],
      },
    ],
    features: [
      plate.features[0],
      {
        id: "boss", kind: "revolve", sketchId: "boss-sketch", angleRad: Math.PI * 2,
        axis: { originM: [0, 0], direction: [0, 1] },
      },
      { id: "join", kind: "union", leftFeatureId: "plate", rightFeatureId: "boss" },
      { id: "hole-tool", kind: "extrude", sketchId: "hole-sketch", distanceM: 0.03 },
      { id: "through-cut", kind: "cut", leftFeatureId: "join", rightFeatureId: "hole-tool" },
    ],
    bodies: [{ id: "finished-body", featureId: "through-cut" }],
  });
}

describe("exact OCCT feature rebuild", () => {
  it("rebuilds an 80 x 40 x 10 mm plate with real BREP and unit-density mass", async () => {
    const kernel = await OcctKernel.init();
    const bridge = createOcctBridge(kernel);
    try {
      const payload = await rebuildDocument(
        bridge,
        await plateDocument(),
        ["brep", "mass-properties"],
        new AbortController().signal,
      );

      expect(payload.brep?.bytes.byteLength).toBeGreaterThan(100);
      expect(payload.massProperties).toMatchObject({
        densityKgM3: 1,
        volumeM3: expect.closeTo(0.000032, 12),
        massKg: expect.closeTo(0.000032, 12),
        surfaceAreaM2: expect.closeTo(0.0088, 12),
      });
      expect(payload.featureIds).toEqual(["plate"]);
      expect(payload.bodyIds).toEqual(["plate-body"]);
      expect(bridge.withKernel((owned) => owned.shapeCount)).toBe(0);
    } finally {
      bridge.dispose();
    }
  });

  it("rebuilds a revolved boss and through-cut with semantic and STEP ownership", async () => {
    const kernel = await OcctKernel.init();
    const bridge = createOcctBridge(kernel);
    try {
      const first = await rebuildDocument(
        bridge,
        await mechanicalPartDocument(),
        ["brep", "semantic-mesh", "mass-properties", "step"],
        new AbortController().signal,
      );
      const expectedVolume = 0.08 * 0.04 * 0.01
        + Math.PI * 0.01 ** 2 * 0.01
        - Math.PI * 0.003 ** 2 * 0.02;
      expect(first.massProperties?.volumeM3).toBeCloseTo(expectedVolume, 10);
      expect(first.semanticMesh?.triangleFaceIndices).toHaveLength((first.semanticMesh?.indices.length ?? 0) / 3);
      expect(first.semanticMesh?.polylineEdgeIndices.length).toBeGreaterThan(0);
      expect([...new Set(first.semanticMesh?.faces.map(({ signature }) => signature.ownerFeatureId))])
        .toEqual(expect.arrayContaining(["plate", "boss", "through-cut"]));

      const imported = bridge.withKernel((owned) => importStepBytes(owned, first.step!.bytes));
      try {
        expect(bridge.withKernel((owned) => owned.getVolume(imported))).toBeCloseTo(expectedVolume, 10);
      } finally {
        bridge.withKernel((owned) => owned.release(imported));
      }

      const changed = await rebuildDocument(
        bridge,
        await mechanicalPartDocument(0.1),
        ["semantic-mesh"],
        new AbortController().signal,
      );
      expect(changed.featureIds).toEqual(first.featureIds);
      expect(changed.bodyIds).toEqual(first.bodyIds);
      const stableIds = (payload: typeof first) => payload.semanticMesh?.faces
        .filter(({ signature }) => ["boss", "through-cut"].includes(signature.ownerFeatureId))
        .filter(({ signature }) => signature.geometry === "cylinder")
        .map(({ id }) => id).sort();
      expect(stableIds(changed)).toEqual(stableIds(first));
      expect(bridge.withKernel((owned) => owned.shapeCount)).toBe(0);
    } finally {
      bridge.dispose();
    }
  });

  it("cancels between ordered features and releases every temporary handle", async () => {
    const kernel = await OcctKernel.init();
    const bridge = createOcctBridge(kernel);
    const controller = new AbortController();
    try {
      const rebuilding = rebuildDocument(
        bridge,
        await mechanicalPartDocument(),
        ["semantic-mesh"],
        controller.signal,
      );
      setTimeout(() => controller.abort(), 0);

      await expect(rebuilding).rejects.toMatchObject({ name: "AbortError" });
      expect(bridge.withKernel((owned) => owned.shapeCount)).toBe(0);
    } finally {
      bridge.dispose();
    }
  });

  it.each([
    ["missing", []],
    ["wrong-kind", [{
      id: "plate-width", label: "Plate width",
      value: { kind: "angle", value: { value: 0.08, unit: "rad" } },
    }]],
  ])("rejects a %s parameter reference before invoking the solid feature", async (_case, parameters) => {
    const content = structuredClone(await plateDocument()) as Record<string, unknown>;
    delete content.revision;
    content.parameters = parameters;
    const document = await defineDesignDocument(content);
    const kernel = await OcctKernel.init();
    const bridge = createOcctBridge(kernel);
    try {
      await expect(rebuildDocument(
        bridge,
        document,
        ["brep"],
        new AbortController().signal,
      )).rejects.toMatchObject({ code: "feature-failed" });
      expect(bridge.withKernel((owned) => owned.shapeCount)).toBe(0);
    } finally {
      bridge.dispose();
    }
  });
});

export { plateDocument };
