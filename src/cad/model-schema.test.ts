import { describe, expect, it } from "vitest";

import { defineDesignDocument } from "./document-schema";

const baseContent = {
  id: "linkage",
  label: "Linkage",
  schemaVersion: 1 as const,
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
        { id: "boss", kind: "revolve", sketchId: "base-sketch", angleRad: Math.PI * 2 },
      ],
      bodies: [{ id: "link-body", featureId: "boss" }],
      components: [{ id: "link-component", bodyIds: ["link-body"] }],
      instances: [{ id: "link-instance", componentId: "link-component", frameId: "world" }],
      mates: [],
      namedSelections: [],
    });

    expect(document.features.map(({ id }) => id)).toEqual(["base", "boss"]);
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
});
