import { describe, expect, it } from "vitest";

import { DefineMateCommandSchema, LegacyMateSchema, MateSchema } from "./index";
import { defineDesignDocument } from "./document-schema";

const endpoints = {
  firstInstanceId: "first-instance",
  secondInstanceId: "second-instance",
  firstSelectionId: "first-face",
  secondSelectionId: "second-face",
} as const;

const reference = (bodyId: string, featureId: string) => ({
  bodyId,
  ownerFeatureId: featureId,
  expectedKind: "face" as const,
  signature: {
    geometry: "plane" as const,
    centroidM: [0, 0, 0] as const,
    measureSI: 1,
    adjacentKinds: [],
  },
});

const baseDocument = {
  id: "joint-document",
  label: "Joint document",
  schemaVersion: 5 as const,
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
    id: "joint-profile", plane: "frame:world", constraints: [],
    entities: [{ id: "outline", kind: "rectangle" as const, centerM: [0, 0] as const, sizeM: [1, 1] as const }],
  }],
  features: [
    { id: "first-feature", kind: "extrude" as const, sketchId: "joint-profile", distanceM: 1 },
    { id: "second-feature", kind: "extrude" as const, sketchId: "joint-profile", distanceM: 1 },
  ],
  bodies: [
    { id: "first-body", featureId: "first-feature" },
    { id: "second-body", featureId: "second-feature" },
  ],
  components: [
    { id: "first-component", bodyIds: ["first-body"] },
    { id: "second-component", bodyIds: ["second-body"] },
  ],
  instances: [
    { id: "first-instance", componentId: "first-component", frameId: "world" },
    { id: "second-instance", componentId: "second-component", frameId: "world" },
  ],
  namedSelections: [
    { id: "first-face", reference: reference("first-body", "first-feature") },
    { id: "second-face", reference: reference("second-body", "second-feature") },
  ],
  materials: [],
  studies: [],
};

describe("assembly mate contract", () => {
  it("accepts rigid, revolute, and prismatic intent without normalizing the local axis", () => {
    expect(MateSchema.parse({ id: "rigid-joint", kind: "rigid", ...endpoints })).toMatchObject({ kind: "rigid" });
    expect(MateSchema.parse({
      id: "revolute-joint", kind: "revolute", ...endpoints,
      axisFirstLocal: [2, 0, 0], lowerRad: -Math.PI, upperRad: Math.PI,
    })).toMatchObject({ axisFirstLocal: [2, 0, 0], lowerRad: -Math.PI, upperRad: Math.PI });
    expect(MateSchema.parse({
      id: "prismatic-joint", kind: "prismatic", ...endpoints,
      axisFirstLocal: [0, 3, 0], lowerM: -0.02, upperM: 0.04,
    })).toMatchObject({ axisFirstLocal: [0, 3, 0], lowerM: -0.02, upperM: 0.04 });
  });

  it("canonicalizes signed zero only in current v5 joint axes and limits", () => {
    const mate = MateSchema.parse({
      id: "canonical-joint", kind: "revolute", ...endpoints,
      axisFirstLocal: [-0, 1, -0], lowerRad: -0, upperRad: 1,
    });
    if (mate.kind !== "revolute") throw new Error("expected revolute mate");
    expect(mate.axisFirstLocal).toEqual([0, 1, 0]);
    expect(Object.is(mate.lowerRad, -0)).toBe(false);
  });

  it.each([
    { name: "zero axis", mate: { id: "zero-axis", kind: "revolute", ...endpoints, axisFirstLocal: [0, 0, 0], lowerRad: -1, upperRad: 1 } },
    { name: "non-finite axis", mate: { id: "nan-axis", kind: "prismatic", ...endpoints, axisFirstLocal: [0, Number.NaN, 0], lowerM: -1, upperM: 1 } },
    { name: "reversed revolute limits", mate: { id: "reversed-angle", kind: "revolute", ...endpoints, axisFirstLocal: [1, 0, 0], lowerRad: 1, upperRad: -1 } },
    { name: "reversed prismatic limits", mate: { id: "reversed-length", kind: "prismatic", ...endpoints, axisFirstLocal: [1, 0, 0], lowerM: 1, upperM: -1 } },
  ])("rejects $name", ({ mate }) => {
    expect(() => MateSchema.parse(mate)).toThrow();
  });

  it("exposes revolute joint intent through the strict define-mate transaction schema", () => {
    const parsed = DefineMateCommandSchema.parse({
      id: "define-elbow-joint", type: "define-mate",
      mate: {
        id: "elbow-joint", kind: "revolute", ...endpoints,
        axisFirstLocal: [0, 0, 4], lowerRad: -1.2, upperRad: 1.2,
      },
    });

    expect(parsed.mate).toMatchObject({ kind: "revolute", axisFirstLocal: [0, 0, 4] });
  });

  it("preserves existing rigid mates while defining a canonical document", async () => {
    const document = await defineDesignDocument({
      ...baseDocument,
      mates: [{ id: "rigid-joint", kind: "rigid", ...endpoints }],
    });

    expect(document.mates).toEqual([{ id: "rigid-joint", kind: "rigid", ...endpoints }]);
  });

  it("migrates legacy rigid mates without admitting joint intent into v2", async () => {
    const { materials: _materials, studies: _studies, ...legacyBase } = baseDocument;
    const rigid = { id: "rigid-joint", kind: "rigid" as const, ...endpoints };
    expect(LegacyMateSchema.parse(rigid)).toEqual(rigid);
    await expect(defineDesignDocument({
      ...legacyBase, schemaVersion: 2, mates: [rigid],
    })).resolves.toMatchObject({ schemaVersion: 5, mates: [rigid] });
    await expect(defineDesignDocument({
      ...legacyBase,
      schemaVersion: 2,
      mates: [{
        id: "legacy-revolute", kind: "revolute", ...endpoints,
        axisFirstLocal: [1, 0, 0], lowerRad: -1, upperRad: 1,
      }],
    })).rejects.toThrow();
  });

  it("keeps the historical v4 mate schema rigid-only before migrating to v5", async () => {
    const revolute = {
      id: "historical-revolute", kind: "revolute" as const, ...endpoints,
      axisFirstLocal: [1, 0, 0] as const, lowerRad: -1, upperRad: 1,
    };
    await expect(defineDesignDocument({
      ...baseDocument, schemaVersion: 4, mates: [revolute],
    })).rejects.toThrow();
    await expect(defineDesignDocument({
      ...baseDocument, schemaVersion: 4,
      mates: [{ id: "historical-rigid", kind: "rigid", ...endpoints }],
      studies: [{ id: "historical-motion", kind: "mechanism", instanceIds: ["first-instance", "second-instance"], mateIds: ["historical-rigid"] }],
    })).resolves.toMatchObject({
      schemaVersion: 5,
      studies: [{ id: "historical-motion", kind: "mechanism", configurationState: "requires-configuration" }],
    });
  });

  it("rejects a mate whose endpoints belong to the same instance", async () => {
    await expect(defineDesignDocument({
      ...baseDocument,
      mates: [{
        id: "self-joint", kind: "rigid",
        firstInstanceId: "first-instance", secondInstanceId: "first-instance",
        firstSelectionId: "first-face", secondSelectionId: "first-face",
      }],
    })).rejects.toThrow(/self/i);
  });

  it("rejects duplicate endpoint pairs regardless of endpoint order", async () => {
    await expect(defineDesignDocument({
      ...baseDocument,
      mates: [
        { id: "first-joint", kind: "rigid", ...endpoints },
        {
          id: "reversed-joint", kind: "rigid",
          firstInstanceId: endpoints.secondInstanceId,
          secondInstanceId: endpoints.firstInstanceId,
          firstSelectionId: endpoints.secondSelectionId,
          secondSelectionId: endpoints.firstSelectionId,
        },
      ],
    })).rejects.toThrow(/duplicate.*endpoint/i);
  });
});
