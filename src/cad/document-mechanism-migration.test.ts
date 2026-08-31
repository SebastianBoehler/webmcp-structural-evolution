import { expect, it } from "vitest";

import { defineDesignDocument } from "./document-schema";

it("migrates a v3 mechanism study into explicit requires-configuration state", async () => {
  const migrated = await defineDesignDocument({
    id: "legacy-linkage",
    label: "Legacy linkage",
    schemaVersion: 3,
    units: { length: "m", angle: "rad", mass: "kg" },
    createdBy: { kind: "human", id: "designer" },
    frames: [{
      id: "world", label: "World",
      transform: {
        position: {
          x: { value: 0, unit: "m" },
          y: { value: 0, unit: "m" },
          z: { value: 0, unit: "m" },
        },
        orientation: {
          roll: { value: 0, unit: "rad" },
          pitch: { value: 0, unit: "rad" },
          yaw: { value: 0, unit: "rad" },
        },
      },
    }],
    parameters: [],
    sketches: [{
      id: "link-profile", plane: "frame:world", constraints: [],
      entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.1, 0.02] }],
    }],
    features: [{ id: "link-feature", kind: "extrude", sketchId: "link-profile", distanceM: 0.01 }],
    bodies: [{ id: "link-body", featureId: "link-feature" }],
    components: [{ id: "link-component", bodyIds: ["link-body"] }],
    instances: [{ id: "link-instance", componentId: "link-component", frameId: "world" }],
    mates: [],
    namedSelections: [],
    materials: [],
    studies: [{ id: "link-motion", kind: "mechanism", instanceIds: ["link-instance"], mateIds: [] }],
  });

  expect(migrated.studies).toEqual([{
    id: "link-motion", kind: "mechanism", configurationState: "requires-configuration",
    instanceIds: ["link-instance"], mateIds: [],
  }]);
  expect(migrated.schemaVersion).toBe(5);
});

it("parses historically unbounded v3 mechanism arrays and fails explicitly at the bounded v5 migration", async () => {
  const instanceIds = Array.from({ length: 257 }, (_, index) => `link-instance-${index}`);
  await expect(defineDesignDocument({
    id: "oversized-legacy-linkage", label: "Oversized legacy linkage", schemaVersion: 3,
    units: { length: "m", angle: "rad", mass: "kg" },
    createdBy: { kind: "human", id: "designer" },
    frames: [{
      id: "world", label: "World",
      transform: {
        position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
        orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
      },
    }],
    parameters: [],
    sketches: [{
      id: "link-profile", plane: "frame:world", constraints: [],
      entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.1, 0.02] }],
    }],
    features: [{ id: "link-feature", kind: "extrude", sketchId: "link-profile", distanceM: 0.01 }],
    bodies: [{ id: "link-body", featureId: "link-feature" }],
    components: [{ id: "link-component", bodyIds: ["link-body"] }],
    instances: instanceIds.map((id) => ({ id, componentId: "link-component", frameId: "world" })),
    mates: [], namedSelections: [], materials: [],
    studies: [{ id: "link-motion", kind: "mechanism", instanceIds, mateIds: [] }],
  })).rejects.toThrow("Legacy mechanism study exceeds the v5 instance budget: link-motion");
});
