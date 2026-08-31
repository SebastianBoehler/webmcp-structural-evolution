import { describe, expect, it } from "vitest";

import { defineDesignDocument } from "../cad/document-schema";
import { MaterialDefinitionSchema } from "./study-schema";

const exactDocument = {
  id: "link",
  label: "Link",
  schemaVersion: 3 as const,
  units: { length: "mm" as const, angle: "deg" as const, mass: "kg" as const },
  createdBy: { kind: "human" as const, id: "sebastian" },
  frames: [{
    id: "world",
    label: "World",
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
    id: "link-profile",
    plane: "frame:world",
    entities: [{ id: "outline", kind: "rectangle" as const, centerM: [0, 0], sizeM: [0.1, 0.02] }],
    constraints: [],
  }],
  features: [{ id: "link-feature", kind: "extrude" as const, sketchId: "link-profile", distanceM: 0.01 }],
  bodies: [{ id: "link-body", featureId: "link-feature" }],
  components: [],
  instances: [],
  mates: [],
  namedSelections: [{
    id: "fixed-end",
    reference: {
      bodyId: "link-body",
      ownerFeatureId: "link-feature",
      expectedKind: "face" as const,
      stableId: "face:link-body:fixed",
      signature: {
        geometry: "plane" as const,
        centroidM: [0, 0, 0],
        measureSI: 0.0002,
        adjacentKinds: ["plane" as const],
      },
    },
  }],
  materials: [],
  studies: [],
};

describe("engineering study schemas", () => {
  it("migrates v3 topology studies to explicit requires-configuration intent", async () => {
    const migrated = await defineDesignDocument({
      ...exactDocument,
      materials: [{
        id: "al-6061", kind: "isotropic", densityKgM3: 2700,
        youngsModulusPa: 68.9e9, poissonRatio: 0.33, failureStressPa: 276e6,
      }],
      studies: [{
        id: "link-static", kind: "structural-linear", bodyIds: ["link-body"],
        materialId: "al-6061", supports: ["fixed-end"],
        loads: [{ selectionId: "fixed-end", forceN: [0, -500, 0] }],
      }, { id: "link-topology", kind: "topology", sourceStudyId: "link-static" }],
    });

    expect(migrated.studies[1]).toEqual({
      id: "link-topology", kind: "topology", sourceStudyId: "link-static",
      configurationState: "requires-configuration",
    });
  });

  it("rejects invalid isotropic properties and unresolved structural load selections", async () => {
    expect(() => MaterialDefinitionSchema.parse({
      id: "invalid-metal",
      kind: "isotropic",
      densityKgM3: 2700,
      youngsModulusPa: 68.9e9,
      poissonRatio: 0.5,
      failureStressPa: 276e6,
    })).toThrow(/poisson/i);

    await expect(defineDesignDocument({
      ...exactDocument,
      materials: [{
        id: "al-6061",
        kind: "isotropic",
        densityKgM3: 2700,
        youngsModulusPa: 68.9e9,
        poissonRatio: 0.33,
        failureStressPa: 276e6,
      }],
      studies: [{
        id: "link-load",
        kind: "structural-linear",
        bodyIds: ["link-body"],
        materialId: "al-6061",
        supports: ["fixed-end"],
        loads: [{ selectionId: "tip", forceN: [0, -500, 0] }],
      }],
    })).rejects.toThrow("Named selection is unresolved: tip");
  });

  it("rejects duplicate intent, incompatible selections, and non-structural topology sources", async () => {
    const aluminum = {
      id: "al-6061",
      kind: "isotropic" as const,
      densityKgM3: 2700,
      youngsModulusPa: 68.9e9,
      poissonRatio: 0.33,
      failureStressPa: 276e6,
    };
    await expect(defineDesignDocument({
      ...exactDocument,
      materials: [aluminum, aluminum],
    })).rejects.toThrow("Duplicate material ID: al-6061");

    await expect(defineDesignDocument({
      ...exactDocument,
      features: [...exactDocument.features, {
        id: "other-feature", kind: "extrude", sketchId: "link-profile", distanceM: 0.01,
      }],
      bodies: [...exactDocument.bodies, { id: "other-body", featureId: "other-feature" }],
      namedSelections: [...exactDocument.namedSelections, {
        id: "other-end",
        reference: {
          bodyId: "other-body",
          ownerFeatureId: "other-feature",
          expectedKind: "face" as const,
          stableId: "face:other-body:end",
          signature: {
            geometry: "plane" as const,
            centroidM: [0.1, 0, 0],
            measureSI: 0.0002,
            adjacentKinds: ["plane" as const],
          },
        },
      }],
      materials: [aluminum],
      studies: [{
        id: "wrong-selection",
        kind: "structural-linear",
        bodyIds: ["link-body"],
        materialId: "al-6061",
        supports: ["fixed-end"],
        loads: [{ selectionId: "other-end", forceN: [0, -500, 0] }],
      }],
    })).rejects.toThrow("Named selection is incompatible with study bodies: other-end");

    await expect(defineDesignDocument({
      ...exactDocument,
      materials: [aluminum],
      studies: [
        { id: "thermal-link", kind: "thermal-steady", bodyIds: ["link-body"], materialId: "al-6061" },
        { id: "invalid-topology", kind: "topology", sourceStudyId: "thermal-link" },
      ],
    })).rejects.toThrow("Topology source study must be structural-linear: thermal-link");
  });
});
