import { expect, it } from "vitest";

import { createDesignDocument } from "../cad/document-schema";
import { addDependentReferences } from "../cad/transaction-dependencies";
import { applyDesignTransaction } from "../cad/transactions";

const actor = { kind: "human", id: "sebastian" } as const;

async function structuralDocument() {
  const document = await createDesignDocument({
    id: "link",
    label: "Link",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: actor,
  });
  const applied = await applyDesignTransaction(document, {
    id: "define-link-model",
    expectedRevision: document.revision,
    actor,
    preconditions: [],
    commands: [
      {
        id: "define-profile",
        type: "define-sketch",
        sketch: {
          id: "link-profile",
          plane: "frame:world",
          entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.1, 0.02] }],
          constraints: [],
        },
      },
      { id: "define-feature", type: "define-feature", feature: { id: "link-feature", kind: "extrude", sketchId: "link-profile", distanceM: 0.01 } },
      { id: "define-body", type: "define-body", body: { id: "link-body", featureId: "link-feature" } },
      ...["fixed-end", "tip"].map((id, index) => ({
        id: `define-${id}`,
        type: "define-named-selection" as const,
        namedSelection: {
          id,
          reference: {
            bodyId: "link-body",
            ownerFeatureId: "link-feature",
            expectedKind: "face" as const,
            stableId: `face:link-body:${id}`,
            signature: {
              geometry: "plane" as const,
              centroidM: [index * 0.1, 0, 0],
              measureSI: 0.0002,
              adjacentKinds: ["plane" as const],
            },
          },
        },
      })),
    ],
  });
  if (!applied.ok) throw new Error("Expected exact link setup to succeed");
  return applied.document;
}

it("defines study intent, propagates its references, and prevents consumed removals", async () => {
  const document = await structuralDocument();
  const defined = await applyDesignTransaction(document, {
    id: "define-study-intent",
    expectedRevision: document.revision,
    actor,
    preconditions: [],
    commands: [
      {
        id: "define-aluminum",
        type: "define-material",
        material: {
          id: "al-6061",
          kind: "isotropic",
          densityKgM3: 2700,
          youngsModulusPa: 68.9e9,
          poissonRatio: 0.33,
          failureStressPa: 276e6,
        },
      },
      {
        id: "define-static",
        type: "define-study",
        study: {
          id: "link-static",
          kind: "structural-linear",
          bodyIds: ["link-body"],
          materialId: "al-6061",
          supports: ["fixed-end"],
          loads: [{ selectionId: "tip", forceN: [0, -500, 0] }],
        },
      },
      {
        id: "define-topology",
        type: "define-study",
        study: {
          id: "link-topology", kind: "topology", sourceStudyId: "link-static",
          configurationState: "configured", objective: "minimum-compliance",
          targetVolumeFraction: 0.75, moveLimit: 0.2, filterRadiusM: 0.01,
          minimumFeatureM: 0.005, maxIterations: 16,
          extraction: { isoValue: 0.5, toleranceM: 1e-6 },
          protectedVoidSelectionIds: [],
          acceptance: {
            maximumDisplacementM: 0.01, maximumVonMisesStressPa: 200e6,
            minimumSafetyFactor: 1.5, maximumMaterialFraction: 0.8,
          },
        },
      },
    ],
  });

  expect(defined).toMatchObject({
    ok: true,
    changedReferences: ["document:link", "material:al-6061", "study:link-static", "study:link-topology"],
  });
  if (!defined.ok) return;

  const references = await applyDesignTransaction(defined.document, {
    id: "study-reference-preconditions",
    expectedRevision: defined.document.revision,
    actor,
    preconditions: [
      { type: "reference-exists", reference: "material:al-6061" },
      { type: "reference-exists", reference: "study:link-static" },
    ],
    commands: [],
  });
  expect(references).toMatchObject({ ok: true, changedReferences: [] });

  const transient = await applyDesignTransaction(defined.document, {
    id: "define-transient-study",
    expectedRevision: defined.document.revision,
    actor,
    preconditions: [],
    commands: [{
      id: "define-thermal",
      type: "define-study",
      study: { id: "transient-thermal", kind: "thermal-steady", bodyIds: ["link-body"], materialId: "al-6061", boundaries: { temperatures: [{ selectionId: "fixed-end", temperatureK: 300 }], heatFluxes: [{ selectionId: "tip", heatFluxWm2: 1000 }] } },
    }],
  });
  expect(transient).toMatchObject({
    ok: true,
    changedReferences: ["document:link", "study:transient-thermal"],
  });
  if (!transient.ok) return;

  const thermalChanges = new Set(["named-selection:tip" as const]);
  addDependentReferences(transient.document, thermalChanges);
  expect(thermalChanges).toContain("study:transient-thermal");

  const transientRemoval = await applyDesignTransaction(transient.document, {
    id: "remove-transient-study",
    expectedRevision: transient.document.revision,
    actor,
    preconditions: [],
    commands: [{ id: "remove-thermal", type: "remove-study", studyId: "transient-thermal" }],
  });
  expect(transientRemoval).toMatchObject({
    ok: true,
    changedReferences: ["document:link", "study:transient-thermal"],
  });

  const spareMaterial = await applyDesignTransaction(defined.document, {
    id: "define-spare-material",
    expectedRevision: defined.document.revision,
    actor,
    preconditions: [],
    commands: [{
      id: "define-steel",
      type: "define-material",
      material: {
        id: "steel",
        kind: "isotropic",
        densityKgM3: 7850,
        youngsModulusPa: 200e9,
        poissonRatio: 0.3,
        failureStressPa: 250e6,
      },
    }],
  });
  expect(spareMaterial).toMatchObject({
    ok: true,
    changedReferences: ["document:link", "material:steel"],
  });
  if (!spareMaterial.ok) return;

  const assignedDocument = {
    ...spareMaterial.document,
    studies: [...spareMaterial.document.studies, {
      id: "assigned-thermal", kind: "thermal-steady" as const, bodyIds: ["link-body"],
      materialAssignments: [{ bodyId: "link-body", materialId: "steel" }],
      boundaries: { temperatures: [{ selectionId: "fixed-end", temperatureK: 300 }], heatFluxes: [] },
    }],
  };
  const assignmentChanges = new Set(["material:steel" as const]);
  addDependentReferences(assignedDocument, assignmentChanges);
  expect(assignmentChanges).toContain("study:assigned-thermal");

  const assignedRemoval = await applyDesignTransaction(assignedDocument, {
    id: "remove-assigned-material", expectedRevision: assignedDocument.revision, actor, preconditions: [],
    commands: [{ id: "remove-assigned-steel", type: "remove-material", materialId: "steel" }],
  });
  expect(assignedRemoval).toMatchObject({ ok: false, code: "command-failed" });

  const spareRemoval = await applyDesignTransaction(spareMaterial.document, {
    id: "remove-spare-material",
    expectedRevision: spareMaterial.document.revision,
    actor,
    preconditions: [],
    commands: [{ id: "remove-steel", type: "remove-material", materialId: "steel" }],
  });
  expect(spareRemoval).toMatchObject({
    ok: true,
    changedReferences: ["document:link", "material:steel"],
  });

  const materialRemoval = await applyDesignTransaction(defined.document, {
    id: "remove-consumed-material",
    expectedRevision: defined.document.revision,
    actor,
    preconditions: [],
    commands: [{ id: "remove-aluminum", type: "remove-material", materialId: "al-6061" }],
  });
  expect(materialRemoval).toMatchObject({ ok: false, code: "command-failed" });
  expect(materialRemoval.diagnostics[0]?.message).toBe("Material has consumers");

  const studyRemoval = await applyDesignTransaction(defined.document, {
    id: "remove-consumed-study",
    expectedRevision: defined.document.revision,
    actor,
    preconditions: [],
    commands: [{ id: "remove-static", type: "remove-study", studyId: "link-static" }],
  });
  expect(studyRemoval).toMatchObject({ ok: false, code: "command-failed" });
  expect(studyRemoval.diagnostics[0]?.message).toBe("Study has consumers");
});
