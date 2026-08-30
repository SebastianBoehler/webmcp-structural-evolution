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
    schemaVersion: 2,
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
      constraints: [
        {
          id: "plate-width", kind: "distance",
          first: { entityId: "plate-outline", point: "left" },
          second: { entityId: "plate-outline", point: "right" }, axis: "x",
          valueM: { parameterId: "plate-width" },
        },
        {
          id: "plate-height", kind: "distance",
          first: { entityId: "plate-outline", point: "bottom" },
          second: { entityId: "plate-outline", point: "top" }, axis: "y", valueM: 0.04,
        },
      ],
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
        constraints: [
          {
            id: "boss-width", kind: "distance",
            first: { entityId: "boss-profile", point: "left" },
            second: { entityId: "boss-profile", point: "right" }, axis: "x", valueM: 0.01,
          },
          {
            id: "boss-height", kind: "distance",
            first: { entityId: "boss-profile", point: "bottom" },
            second: { entityId: "boss-profile", point: "top" }, axis: "y", valueM: 0.01,
          },
        ],
      },
      {
        id: "hole-sketch", plane: "frame:world",
        entities: [{ id: "hole-profile", kind: "circle", centerM: [0, 0], radiusM: 0.003 }],
        constraints: [{ id: "hole-radius", kind: "radius", entityId: "hole-profile", valueM: 0.003 }],
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

  it("resolves upstream-lineage named selections and reports affected consumers when repair is required", async () => {
    const source = await mechanicalPartDocument();
    const kernel = await OcctKernel.init();
    const bridge = createOcctBridge(kernel);
    try {
      const initial = await rebuildDocument(
        bridge, source, ["semantic-mesh"], new AbortController().signal,
      );
      const upstreamFace = initial.semanticMesh!.faces.find(({ signature }) =>
        signature.ownerFeatureId === "plate" && signature.geometry === "plane")!;
      const content = structuredClone(source) as Record<string, unknown>;
      delete content.revision;
      const selected = await defineDesignDocument({
        ...content,
        namedSelections: [{
          id: "mount-face",
          reference: {
            bodyId: upstreamFace.bodyId,
            ownerFeatureId: upstreamFace.signature.ownerFeatureId,
            expectedKind: upstreamFace.signature.kind,
            stableId: upstreamFace.id,
            signature: {
              geometry: upstreamFace.signature.geometry,
              centroidM: upstreamFace.signature.centroidM,
              measureSI: upstreamFace.signature.measureSI,
              adjacentKinds: upstreamFace.signature.adjacentKinds,
            },
          },
        }],
      });
      await expect(rebuildDocument(
        bridge, selected, ["brep"], new AbortController().signal,
      )).resolves.toMatchObject({ bodyIds: ["finished-body"] });

      const brokenContent = structuredClone(selected) as Record<string, unknown>;
      delete brokenContent.revision;
      const brokenSelection = structuredClone(selected.namedSelections[0]!) as unknown as {
        reference: { stableId: string; signature: { centroidM: [number, number, number] } };
      };
      brokenSelection.reference.stableId = "missing-topology";
      brokenSelection.reference.signature.centroidM[0] += 1;
      const broken = await defineDesignDocument({
        ...brokenContent, namedSelections: [brokenSelection],
      });
      await expect(rebuildDocument(
        bridge, broken, ["brep"], new AbortController().signal,
      )).rejects.toMatchObject({
        code: "reference-requires-repair",
        affectedConsumers: ["named-selection:mount-face"],
      });
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
    ["unsatisfied", [
      {
        id: "wrong-width", kind: "distance",
        first: { entityId: "plate-outline", point: "left" },
        second: { entityId: "plate-outline", point: "right" }, axis: "x", valueM: 0.07,
      },
      {
        id: "plate-height", kind: "distance",
        first: { entityId: "plate-outline", point: "bottom" },
        second: { entityId: "plate-outline", point: "top" }, axis: "y", valueM: 0.04,
      },
    ], "sketch-constraint-unsatisfied"],
    ["under-constrained", [{
      id: "plate-width", kind: "distance",
      first: { entityId: "plate-outline", point: "left" },
      second: { entityId: "plate-outline", point: "right" }, axis: "x", valueM: 0.08,
    }], "sketch-under-constrained"],
    ["over-constrained", [
      {
        id: "plate-width", kind: "distance",
        first: { entityId: "plate-outline", point: "left" },
        second: { entityId: "plate-outline", point: "right" }, axis: "x", valueM: 0.08,
      },
      {
        id: "duplicate-width", kind: "distance",
        first: { entityId: "plate-outline", point: "left" },
        second: { entityId: "plate-outline", point: "right" }, axis: "x", valueM: 0.08,
      },
      {
        id: "plate-height", kind: "distance",
        first: { entityId: "plate-outline", point: "bottom" },
        second: { entityId: "plate-outline", point: "top" }, axis: "y", valueM: 0.04,
      },
    ], "sketch-over-constrained"],
  ] as const)("rejects a %s resolved sketch with a typed diagnostic", async (_label, constraints, code) => {
    const source = await plateDocument();
    const content = structuredClone(source) as Record<string, unknown>;
    delete content.revision;
    const document = await defineDesignDocument({
      ...content,
      sketches: [{ ...source.sketches[0], constraints }],
    });
    const kernel = await OcctKernel.init();
    const bridge = createOcctBridge(kernel);
    try {
      await expect(rebuildDocument(
        bridge, document, ["brep"], new AbortController().signal,
      )).rejects.toMatchObject({ code });
      expect(bridge.withKernel((owned) => owned.shapeCount)).toBe(0);
    } finally {
      bridge.dispose();
    }
  });

  it("rejects a disjoint union instead of publishing a multi-solid body", async () => {
    const plate = await plateDocument();
    const content = structuredClone(plate) as Record<string, unknown>;
    delete content.revision;
    const document = await defineDesignDocument({
      ...content,
      sketches: [
        ...plate.sketches,
        {
          id: "remote-sketch", plane: "frame:world",
          entities: [{ id: "remote-outline", kind: "rectangle", centerM: [0.2, 0], sizeM: [0.01, 0.01] }],
          constraints: [
            {
              id: "remote-width", kind: "distance",
              first: { entityId: "remote-outline", point: "left" },
              second: { entityId: "remote-outline", point: "right" }, axis: "x", valueM: 0.01,
            },
            {
              id: "remote-height", kind: "distance",
              first: { entityId: "remote-outline", point: "bottom" },
              second: { entityId: "remote-outline", point: "top" }, axis: "y", valueM: 0.01,
            },
          ],
        },
      ],
      features: [
        ...plate.features,
        { id: "remote", kind: "extrude", sketchId: "remote-sketch", distanceM: 0.01 },
        { id: "disjoint", kind: "union", leftFeatureId: "plate", rightFeatureId: "remote" },
      ],
      bodies: [{ id: "disjoint-body", featureId: "disjoint" }],
    });
    const kernel = await OcctKernel.init();
    const bridge = createOcctBridge(kernel);
    try {
      await expect(rebuildDocument(
        bridge, document, ["brep"], new AbortController().signal,
      )).rejects.toMatchObject({ code: "invalid-solid" });
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
