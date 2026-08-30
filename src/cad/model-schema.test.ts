import { describe, expect, it } from "vitest";

import { defineDesignDocument } from "./document-schema";

const baseContent = {
  id: "linkage",
  label: "Linkage",
  schemaVersion: 2 as const,
  units: { length: "mm" as const, angle: "deg" as const, mass: "kg" as const },
  createdBy: { kind: "human" as const, id: "sebastian" },
  frames: [{
    id: "world",
    label: "World",
    transform: {
      position: {
        x: { value: 0, unit: "m" as const }, y: { value: 0, unit: "m" as const }, z: { value: 0, unit: "m" as const },
      },
      orientation: {
        roll: { value: 0, unit: "rad" as const }, pitch: { value: 0, unit: "rad" as const }, yaw: { value: 0, unit: "rad" as const },
      },
    },
  }],
  parameters: [],
};

const profile = {
  id: "base-sketch",
  plane: "frame:world",
  entities: [{ id: "outline", kind: "rectangle" as const, centerM: [0, 0], sizeM: [0.08, 0.04] }],
  constraints: [{
    id: "width", kind: "distance" as const, first: { entityId: "outline", point: "left" as const },
    second: { entityId: "outline", point: "right" as const }, axis: "x" as const, valueM: 0.08,
  }],
};

describe("exact model schemas", () => {
  it("accepts a constrained closed profile and ordered exact features", async () => {
    const document = await defineDesignDocument({
      ...baseContent,
      sketches: [profile],
      features: [
        { id: "base", kind: "extrude", sketchId: "base-sketch", distanceM: 0.01 },
        { id: "boss", kind: "revolve", sketchId: "base-sketch", angleRad: Math.PI * 2, axis: { originM: [0, 0], direction: [0, 1] } },
      ],
      bodies: [{ id: "link-body", featureId: "boss" }],
      components: [{ id: "link-component", bodyIds: ["link-body"] }],
      instances: [{ id: "link-instance", componentId: "link-component", frameId: "world" }],
      mates: [],
      namedSelections: [],
    });

    expect(document.features.map(({ id }) => id)).toEqual(["base", "boss"]);
  });

  it("accepts parameterized SI geometry and an explicit sketch-local revolve axis", async () => {
    const document = await defineDesignDocument({
      ...baseContent,
      parameters: [
        { id: "boss-radius", label: "Boss radius", value: { kind: "length", value: { value: 0.01, unit: "m" } } },
        { id: "full-turn", label: "Full turn", value: { kind: "angle", value: { value: Math.PI * 2, unit: "rad" } } },
      ],
      sketches: [{
        id: "boss-sketch", plane: "frame:world",
        entities: [{
          id: "boss-profile", kind: "rectangle", centerM: [{ parameterId: "boss-radius" }, 0.005],
          sizeM: [{ parameterId: "boss-radius" }, 0.01],
        }],
        constraints: [],
      }],
      features: [{
        id: "boss", kind: "revolve", sketchId: "boss-sketch",
        angleRad: { parameterId: "full-turn" },
        axis: { originM: [0, 0], direction: [0, 1] },
      }],
      bodies: [{ id: "boss-body", featureId: "boss" }],
      components: [], instances: [], mates: [], namedSelections: [],
    });

    expect(document.features[0]).toMatchObject({
      kind: "revolve",
      axis: { originM: [0, 0], direction: [0, 1] },
    });
  });

  it("rejects unresolved profile and assembly references, open solid profiles, and forward feature dependencies", async () => {
    const content = {
      ...baseContent,
      sketches: [{ ...profile, entities: [{ id: "edge", kind: "line" as const, startM: [0, 0], endM: [0.08, 0] }], constraints: [] }],
      features: [{ id: "base", kind: "extrude" as const, sketchId: "base-sketch", distanceM: 0.01 }],
      bodies: [{ id: "link-body", featureId: "base" }], components: [{ id: "link-component", bodyIds: ["link-body"] }],
      instances: [{ id: "link-instance", componentId: "link-component", frameId: "world" }], mates: [], namedSelections: [],
    };

    await expect(defineDesignDocument(content)).rejects.toThrow(/open profile/i);
    await expect(defineDesignDocument({
      ...content,
      sketches: [profile],
      features: [{ id: "cut", kind: "cut", leftFeatureId: "later", rightFeatureId: "base" }, { id: "later", kind: "extrude", sketchId: "base-sketch", distanceM: 0.01 }],
    })).rejects.toThrow(/forward/i);
    await expect(defineDesignDocument({
      ...content,
      sketches: [profile],
      components: [{ id: "link-component", bodyIds: ["missing-body"] }],
    })).rejects.toThrow(/unresolved/i);
  });

  it("rejects non-finite coordinates and non-positive solid dimensions", async () => {
    const content = {
      ...baseContent, sketches: [profile], features: [{ id: "base", kind: "extrude" as const, sketchId: "base-sketch", distanceM: 0.01 }],
      bodies: [{ id: "link-body", featureId: "base" }], components: [], instances: [], mates: [], namedSelections: [],
    };

    await expect(defineDesignDocument({
      ...content,
      sketches: [{ ...profile, entities: [{ id: "outline", kind: "circle", centerM: [Number.NaN, 0], radiusM: 0.04 }], constraints: [] }],
    })).rejects.toThrow();
    await expect(defineDesignDocument({ ...content, features: [{ id: "base", kind: "extrude", sketchId: "base-sketch", distanceM: 0 }] })).rejects.toThrow();
  });

  it("rejects a solid sketch that mixes a closed profile with an open entity", async () => {
    await expect(defineDesignDocument({
      ...baseContent,
      sketches: [{
        ...profile,
        entities: [
          ...profile.entities,
          { id: "open-edge", kind: "line", startM: [0.1, 0], endM: [0.2, 0] },
        ],
      }],
      features: [{ id: "base", kind: "extrude", sketchId: "base-sketch", distanceM: 0.01 }],
      bodies: [], components: [], instances: [], mates: [], namedSelections: [],
    })).rejects.toThrow(/open profile/i);
  });

  it("accepts Euclidean and explicitly projected distance constraints", async () => {
    const document = await defineDesignDocument({
      ...baseContent,
      sketches: [{
        id: "constraint-sketch",
        plane: "frame:world",
        entities: [
          { id: "diagonal", kind: "line", startM: [0, 0], endM: [0.03, 0.04] },
          { id: "vertical", kind: "line", startM: [0, 0], endM: [0, 0.04] },
          { id: "arc", kind: "arc", centerM: [0.04, 0], radiusM: 0.01, startAngleRad: 0, endAngleRad: Math.PI / 2 },
          { id: "circle", kind: "circle", centerM: [0.06, 0.02], radiusM: 0.01 },
        ],
        constraints: [
          { id: "diagonal-length", kind: "distance", first: { entityId: "diagonal", point: "start" }, second: { entityId: "diagonal", point: "end" }, valueM: 0.05 },
          { id: "projected-height", kind: "distance", first: { entityId: "diagonal", point: "start" }, second: { entityId: "diagonal", point: "end" }, axis: "y", valueM: 0.04 },
          { id: "horizontal", kind: "horizontal", entityId: "diagonal" },
          { id: "vertical", kind: "vertical", entityId: "vertical" },
          { id: "arc-radius", kind: "radius", entityId: "arc", valueM: 0.01 },
          { id: "circle-radius", kind: "radius", entityId: "circle", valueM: 0.01 },
          {
            id: "corner-angle", kind: "angle", vertex: { entityId: "diagonal", point: "start" },
            firstDirection: { entityId: "diagonal", point: "end" }, secondDirection: { entityId: "vertical", point: "end" }, valueRad: Math.atan2(3, 4),
          },
        ],
      }],
      features: [], bodies: [], components: [], instances: [], mates: [], namedSelections: [],
    });

    expect(document.sketches[0]?.constraints).toHaveLength(7);
  });

  it("rejects incompatible sketch constraints", async () => {
    const content = {
      ...baseContent,
      sketches: [{
        id: "constraint-sketch", plane: "frame:world",
        entities: [
          { id: "outline", kind: "rectangle" as const, centerM: [0, 0], sizeM: [0.08, 0.04] },
          { id: "circle", kind: "circle" as const, centerM: [0.06, 0.02], radiusM: 0.01 },
          { id: "edge", kind: "line" as const, startM: [0, 0], endM: [0.04, 0] },
        ],
        constraints: [],
      }],
      features: [], bodies: [], components: [], instances: [], mates: [], namedSelections: [],
    };

    await expect(defineDesignDocument({
      ...content,
      sketches: [{ ...content.sketches[0], constraints: [{ id: "not-line", kind: "horizontal", entityId: "outline" }] }],
    })).rejects.toThrow(/horizontal/i);
    await expect(defineDesignDocument({
      ...content,
      sketches: [{ ...content.sketches[0], constraints: [{ id: "not-line", kind: "vertical", entityId: "circle" }] }],
    })).rejects.toThrow(/vertical/i);
    await expect(defineDesignDocument({
      ...content,
      sketches: [{ ...content.sketches[0], constraints: [{ id: "not-round", kind: "radius", entityId: "edge", valueM: 0.01 }] }],
    })).rejects.toThrow(/radius/i);
    await expect(defineDesignDocument({
      ...content,
      sketches: [{
        ...content.sketches[0],
        constraints: [{ id: "ambiguous-angle", kind: "angle", first: { entityId: "edge", point: "start" }, second: { entityId: "edge", point: "end" }, valueRad: 0 }],
      }],
    })).rejects.toThrow();
  });

  it("rejects a mate selection outside its instance component", async () => {
    await expect(defineDesignDocument({
      ...baseContent,
      sketches: [profile],
      features: [
        { id: "first-feature", kind: "extrude", sketchId: "base-sketch", distanceM: 0.01 },
        { id: "second-feature", kind: "extrude", sketchId: "base-sketch", distanceM: 0.01 },
      ],
      bodies: [{ id: "first-body", featureId: "first-feature" }, { id: "second-body", featureId: "second-feature" }],
      components: [{ id: "first-component", bodyIds: ["first-body"] }, { id: "second-component", bodyIds: ["second-body"] }],
      instances: [{ id: "first-instance", componentId: "first-component", frameId: "world" }, { id: "second-instance", componentId: "second-component", frameId: "world" }],
      namedSelections: [
        { id: "first-face", bodyId: "first-body", featureId: "first-feature", query: { kind: "face", selector: "top" } },
        { id: "second-face", bodyId: "second-body", featureId: "second-feature", query: { kind: "face", selector: "top" } },
      ],
      mates: [{ id: "bad-mate", kind: "rigid", firstInstanceId: "first-instance", secondInstanceId: "second-instance", firstSelectionId: "second-face", secondSelectionId: "second-face" }],
    })).rejects.toThrow(/mate selection/i);
  });

  it("rejects duplicate terminal-feature ownership across exact bodies", async () => {
    await expect(defineDesignDocument({
      ...baseContent,
      sketches: [profile],
      features: [{ id: "base", kind: "extrude", sketchId: "base-sketch", distanceM: 0.01 }],
      bodies: [
        { id: "first-body", featureId: "base" },
        { id: "second-body", featureId: "base" },
      ],
      components: [], instances: [], mates: [], namedSelections: [],
    })).rejects.toThrow(/multiple body owners|terminal feature/i);
  });
});
