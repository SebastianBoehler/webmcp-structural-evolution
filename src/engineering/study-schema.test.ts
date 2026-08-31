import { describe, expect, it } from "vitest";

import { defineDesignDocument } from "../cad/document-schema";
import { MaterialDefinitionSchema, MechanismStudySchema } from "./study-schema";

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

  it("owns complete configured mechanism intent and rejects out-of-study references", () => {
    const configured = {
      id: "arm-motion", kind: "mechanism" as const, configurationState: "configured" as const,
      instanceIds: ["base", "link"], mateIds: ["base-link"], fixedInstanceIds: ["base"],
      materialAssignments: [
        { instanceId: "base", materialId: "steel" },
        { instanceId: "link", materialId: "aluminum" },
      ],
      gravityWorldMps2: [0, -9.81, 0],
      pointForces: [{ instanceId: "link", pointLocalM: [0.1, 0, 0], forceWorldN: [0, 5, 0] }],
      maximumCollisionApproximationErrorM: 0.0005,
      durationSteps: 480, outputStrideSteps: 4,
      collisionGroups: [
        { id: "fixed-parts", instanceIds: ["base"], membershipMask: 1, filterMask: 2 },
        { id: "moving-parts", instanceIds: ["link"], membershipMask: 2, filterMask: 1 },
      ],
      clearancePairs: [{ id: "base-link-clearance", firstInstanceId: "base", secondInstanceId: "link" }],
    };
    expect(MechanismStudySchema.parse(configured)).toEqual(configured);
    expect(() => MechanismStudySchema.parse({
      ...configured, pointForces: [{ ...configured.pointForces[0], instanceId: "tool" }],
    })).toThrow("Mechanism point-force instance is outside the study: tool");
    expect(() => MechanismStudySchema.parse({
      ...configured, collisionGroups: [{ ...configured.collisionGroups[0], membershipMask: 2 ** 32 }],
    })).toThrow();
    expect(() => MechanismStudySchema.parse({
      ...configured, durationSteps: 10, outputStrideSteps: 4,
    })).toThrow("Mechanism duration must be divisible by output stride");
    expect(() => MechanismStudySchema.parse({
      ...configured, maximumCollisionApproximationErrorM: 0,
    })).toThrow();
    expect(() => MechanismStudySchema.parse({
      ...configured, materialAssignments: [configured.materialAssignments[0]],
    })).toThrow("Mechanism instance must have exactly one material assignment: link");
    const canonical = MechanismStudySchema.parse({
      ...configured,
      gravityWorldMps2: [-0, -9.81, -0],
      pointForces: [{ ...configured.pointForces[0], pointLocalM: [-0, 0.1, -0], forceWorldN: [-0, 5, -0] }],
      collisionGroups: configured.collisionGroups.map((group) => ({ ...group, filterMask: -0 })),
    });
    if (canonical.configurationState !== "configured") throw new Error("expected configured study");
    expect(Object.is(canonical.gravityWorldMps2[0], -0)).toBe(false);
    expect(Object.is(canonical.pointForces[0]?.pointLocalM[0], -0)).toBe(false);
    expect(Object.is(canonical.collisionGroups[0]?.filterMask, -0)).toBe(false);
    expect(() => MechanismStudySchema.parse({
      ...configured, collisionGroups: [configured.collisionGroups[0]],
    })).toThrow("Mechanism instance must belong to exactly one collision group: link");
    expect(() => MechanismStudySchema.parse({
      ...configured,
      clearancePairs: [configured.clearancePairs[0], {
        id: "reverse-clearance", firstInstanceId: "link", secondInstanceId: "base",
      }],
    })).toThrow("Mechanism instance pair has multiple clearance queries: base/link");
    expect(() => MechanismStudySchema.parse({
      ...configured, clearancePairs: [configured.clearancePairs[0], { ...configured.clearancePairs[0] }],
    })).toThrow("Duplicate mechanism clearance pair ID: base-link-clearance");
  });

  it("represents legacy mechanism intent as requiring configuration", () => {
    expect(MechanismStudySchema.parse({
      id: "arm-motion", kind: "mechanism", configurationState: "requires-configuration",
      instanceIds: ["base", "link"], mateIds: ["base-link"],
    })).toMatchObject({ configurationState: "requires-configuration" });
  });

  it("rejects a mechanism mate whose endpoint is outside the study", async () => {
    const configuredStudy = {
      id: "base-only", kind: "mechanism" as const, configurationState: "configured" as const,
      instanceIds: ["base"], mateIds: ["base-link"], fixedInstanceIds: ["base"],
      materialAssignments: [{ instanceId: "base", materialId: "al-6061" }],
      gravityWorldMps2: [0, -9.81, 0], pointForces: [], durationSteps: 240, outputStrideSteps: 4,
      maximumCollisionApproximationErrorM: 0.0005,
      collisionGroups: [{ id: "base-group", instanceIds: ["base"], membershipMask: 1, filterMask: 0 }],
      clearancePairs: [],
    };
    await expect(defineDesignDocument({
      ...exactDocument, schemaVersion: 5,
      frames: [...exactDocument.frames, { id: "link-frame", label: "Link frame", parentId: "world", transform: exactDocument.frames[0]!.transform }],
      components: [{ id: "link-component", bodyIds: ["link-body"] }],
      instances: [
        { id: "base", componentId: "link-component", frameId: "world" },
        { id: "link", componentId: "link-component", frameId: "link-frame" },
      ],
      mates: [{ id: "base-link", kind: "rigid", firstInstanceId: "base", secondInstanceId: "link", firstSelectionId: "fixed-end", secondSelectionId: "fixed-end" }],
      materials: [{
        id: "al-6061", kind: "isotropic", densityKgM3: 2700,
        youngsModulusPa: 68.9e9, poissonRatio: 0.33, failureStressPa: 276e6,
      }],
      studies: [configuredStudy],
    })).rejects.toThrow("Mechanism mate references an instance outside the study: base-link");
    await expect(defineDesignDocument({
      ...exactDocument, schemaVersion: 5,
      frames: [...exactDocument.frames, { id: "link-frame", label: "Link frame", parentId: "world", transform: exactDocument.frames[0]!.transform }],
      components: [{ id: "link-component", bodyIds: ["link-body"] }],
      instances: [{ id: "base", componentId: "link-component", frameId: "world" }],
      materials: [],
      studies: [{ ...configuredStudy, mateIds: [], materialAssignments: [{ instanceId: "base", materialId: "missing-material" }] }],
    })).rejects.toThrow("Mechanism material is unresolved: missing-material");
  });

  it("bounds every revision-owned mechanism study array", () => {
    const instanceIds = Array.from({ length: 257 }, (_, index) => `instance-${index}`);
    const clearancePairs: { id: string; firstInstanceId: string; secondInstanceId: string }[] = [];
    for (let first = 0; first < 33 && clearancePairs.length < 513; first += 1) {
      for (let second = first + 1; second < 33 && clearancePairs.length < 513; second += 1) {
        clearancePairs.push({
          id: `clearance-${clearancePairs.length}`,
          firstInstanceId: instanceIds[first]!, secondInstanceId: instanceIds[second]!,
        });
      }
    }
    expect(MechanismStudySchema.safeParse({
      id: "bounded-study", kind: "mechanism", configurationState: "configured",
      instanceIds, mateIds: instanceIds.map((_, index) => `mate-${index}`),
      fixedInstanceIds: instanceIds,
      materialAssignments: instanceIds.map((instanceId) => ({ instanceId, materialId: "steel" })),
      gravityWorldMps2: [0, -9.81, 0],
      maximumCollisionApproximationErrorM: 0.0005,
      pointForces: instanceIds.map((instanceId) => ({ instanceId, pointLocalM: [0, 0, 0], forceWorldN: [1, 0, 0] })),
      durationSteps: 240, outputStrideSteps: 4,
      collisionGroups: instanceIds.map((instanceId, index) => ({
        id: `group-${index}`, instanceIds: [instanceId], membershipMask: 1, filterMask: 1,
      })),
      clearancePairs,
    }).success).toBe(false);
  });
});
