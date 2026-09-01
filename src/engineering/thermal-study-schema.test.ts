import { describe, expect, it } from "vitest";

import { defineDesignDocument } from "../cad/document-schema";
import { ThermalSteadyStudySchema, type StudyIntegrityInput } from "./study-schema";

const frame = { id: "world", label: "World", transform: {
  position: { x: { value: 0, unit: "m" as const }, y: { value: 0, unit: "m" as const }, z: { value: 0, unit: "m" as const } },
  orientation: { roll: { value: 0, unit: "rad" as const }, pitch: { value: 0, unit: "rad" as const }, yaw: { value: 0, unit: "rad" as const } },
} };
const selection = (id: string, bodyId: string, ownerFeatureId: string) => ({
  id, reference: { bodyId, ownerFeatureId, expectedKind: "face" as const,
    stableId: `face:${bodyId}:${id}`, signature: { geometry: "plane" as const,
      centroidM: [0, 0, 0] as [number, number, number], measureSI: 1, adjacentKinds: [] } },
});
const document = {
  id: "thermal-contract", label: "Thermal", schemaVersion: 6 as const,
  units: { length: "m" as const, angle: "rad" as const, mass: "kg" as const },
  createdBy: { kind: "human" as const, id: "tester" }, frames: [frame], parameters: [],
  sketches: [{ id: "profile", plane: "frame:world", constraints: [],
    entities: [{ id: "outline", kind: "rectangle" as const, centerM: [0, 0], sizeM: [1, 1] }] }],
  features: [
    { id: "left-feature", kind: "extrude" as const, sketchId: "profile", distanceM: 1 },
    { id: "right-feature", kind: "extrude" as const, sketchId: "profile", distanceM: 1 },
  ], bodies: [{ id: "left", featureId: "left-feature" }, { id: "right", featureId: "right-feature" }],
  components: [], instances: [], mates: [], namedSelections: [
    selection("left-face", "left", "left-feature"), selection("right-face", "right", "right-feature"),
  ], materials: [], studies: [],
};

describe("thermal study material forms", () => {
  it("exposes the canonical named-selection topology kind to integrity consumers", () => {
    const input: StudyIntegrityInput = { bodies: [], materials: [], studies: [], instances: [], mates: [],
      namedSelections: [{ id: "thermal-face", reference: { bodyId: "left", expectedKind: "face" } }] };
    expect(input.namedSelections[0]!.reference.expectedKind).toBe("face");
  });
  it("accepts mutually exclusive legacy and exact assigned forms", async () => {
    const assigned = { id: "wall", kind: "thermal-steady" as const, bodyIds: ["left", "right"],
      materialAssignments: [{ bodyId: "left", materialId: "conductive" }, { bodyId: "right", materialId: "insulating" }] };
    const parsed = ThermalSteadyStudySchema.parse(assigned);
    expect("materialAssignments" in parsed && parsed.materialAssignments).toHaveLength(2);
    expect(() => ThermalSteadyStudySchema.parse({ ...assigned, materialId: "legacy" })).toThrow();
    expect(() => ThermalSteadyStudySchema.parse({ ...assigned,
      materialAssignments: assigned.materialAssignments.slice(0, 1) })).toThrow(/exactly one/);
    expect(() => ThermalSteadyStudySchema.parse({ ...assigned,
      materialAssignments: [assigned.materialAssignments[0], assigned.materialAssignments[0]] })).toThrow(/unique/);
    const { materialAssignments: _assignments, ...base } = assigned;
    expect(() => ThermalSteadyStudySchema.parse(base)).toThrow();
    expect(ThermalSteadyStudySchema.parse({ ...base, materialId: "legacy" }))
      .not.toHaveProperty("materialAssignments");
    await expect(defineDesignDocument({ ...document, studies: [{ id: "assigned", kind: "thermal-steady",
      bodyIds: ["left"], materialAssignments: [{ bodyId: "left", materialId: "missing-material" }] }] }))
      .rejects.toThrow("Material is unresolved: missing-material");
  });

  it("rejects a boundary outside the study bodies", async () => {
    await expect(defineDesignDocument({ ...document,
      materials: [{ id: "metal", kind: "isotropic", densityKgM3: 1, youngsModulusPa: 1,
        poissonRatio: 0, failureStressPa: 1 }],
      studies: [{ id: "thermal", kind: "thermal-steady", bodyIds: ["left"], materialId: "metal",
        boundaries: { temperatures: [{ selectionId: "right-face", temperatureK: 300 }], heatFluxes: [] } }] }))
      .rejects.toThrow("Thermal boundary selection is incompatible with study bodies: right-face");
  });
});
