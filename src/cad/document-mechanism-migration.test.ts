import { expect, it } from "vitest";

import { revisionId } from "../domain/revisions";
import { defineDesignDocument } from "./document-schema";

const configuredVersionFiveDocument = {
  id: "configured-v5-linkage", label: "Configured v5 linkage", schemaVersion: 5 as const,
  units: { length: "m" as const, angle: "rad" as const, mass: "kg" as const },
  createdBy: { kind: "human" as const, id: "designer" },
  frames: [{
    id: "world", label: "World",
    transform: {
      position: {
        x: { value: 0, unit: "m" as const },
        y: { value: 0, unit: "m" as const },
        z: { value: 0, unit: "m" as const },
      },
      orientation: {
        roll: { value: 0, unit: "rad" as const },
        pitch: { value: 0, unit: "rad" as const },
        yaw: { value: 0, unit: "rad" as const },
      },
    },
  }],
  parameters: [],
  sketches: [{
    id: "link-profile", plane: "frame:world", constraints: [],
    entities: [{ id: "outline", kind: "rectangle" as const, centerM: [0, 0] as const, sizeM: [0.1, 0.02] as const }],
  }],
  features: [{ id: "link-feature", kind: "extrude" as const, sketchId: "link-profile", distanceM: 0.01 }],
  bodies: [{ id: "link-body", featureId: "link-feature" }],
  components: [{ id: "link-component", bodyIds: ["link-body"] }],
  instances: [{ id: "link-instance", componentId: "link-component", frameId: "world" }],
  mates: [], namedSelections: [],
  materials: [{
    id: "steel", kind: "isotropic" as const, densityKgM3: 7850,
    youngsModulusPa: 200e9, poissonRatio: 0.3, failureStressPa: 250e6,
  }],
  studies: [{
    id: "link-motion", kind: "mechanism" as const, configurationState: "configured" as const,
    instanceIds: ["link-instance"], mateIds: [], fixedInstanceIds: ["link-instance"],
    materialAssignments: [{ instanceId: "link-instance", materialId: "steel" }],
    gravityWorldMps2: [0, -9.81, 0] as const, pointForces: [],
    maximumCollisionApproximationErrorM: 0.0005,
    durationSteps: 240, outputStrideSteps: 4,
    collisionGroups: [{
      id: "link-group", instanceIds: ["link-instance"], membershipMask: 1, filterMask: 0,
    }],
    clearancePairs: [],
  }],
};

it("migrates the historical configured v5 mechanism shape to explicit v6 overlap policy", async () => {
  const sourceRevision = await revisionId(configuredVersionFiveDocument);

  const migrated = await defineDesignDocument(configuredVersionFiveDocument);

  expect(migrated).toMatchObject({
    schemaVersion: 6,
    migrationProvenance: { sourceSchemaVersion: 5, sourceRevision },
    studies: [{
      id: "link-motion",
      kind: "mechanism",
      configurationState: "configured",
      initialOverlapPolicy: "reject-any-positive-volume",
    }],
  });
});

it("requires the overlap policy on native v6 configured mechanism documents", async () => {
  await expect(defineDesignDocument({
    ...configuredVersionFiveDocument,
    schemaVersion: 6,
  })).rejects.toThrow(/initialOverlapPolicy/);

  await expect(defineDesignDocument({
    ...configuredVersionFiveDocument,
    schemaVersion: 6,
    studies: configuredVersionFiveDocument.studies.map((study) => ({
      ...study, initialOverlapPolicy: "reject-any-positive-volume" as const,
    })),
  })).resolves.toMatchObject({ schemaVersion: 6 });
});

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
  expect(migrated.schemaVersion).toBe(6);
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
