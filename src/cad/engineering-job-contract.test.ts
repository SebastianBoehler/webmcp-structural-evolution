import { describe, expect, it } from "vitest";

import { defineArtifactRecord } from "./artifact-contract";
import { createDesignDocument } from "./document-schema";
import { defineEngineeringSolveRequest } from "./runtime-contracts";
import { applyDesignTransaction } from "./transactions";

const actor = { kind: "human", id: "sebastian" } as const;

async function solveDocument() {
  const document = await createDesignDocument({
    id: "link",
    label: "Link",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: actor,
  });
  const applied = await applyDesignTransaction(document, {
    id: "define-solve-study",
    expectedRevision: document.revision,
    actor,
    preconditions: [],
    commands: [
      {
        id: "define-profile", type: "define-sketch",
        sketch: {
          id: "link-profile", plane: "frame:world", constraints: [],
          entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.1, 0.02] }],
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
            bodyId: "link-body", ownerFeatureId: "link-feature", expectedKind: "face" as const,
            stableId: `face:link-body:${id}`,
            signature: {
              geometry: "plane" as const, centroidM: [index * 0.1, 0, 0], measureSI: 0.0002,
              adjacentKinds: ["plane" as const],
            },
          },
        },
      })),
      {
        id: "define-material", type: "define-material",
        material: { id: "al-6061", kind: "isotropic", densityKgM3: 2700, youngsModulusPa: 68.9e9, poissonRatio: 0.33, failureStressPa: 276e6 },
      },
      {
        id: "define-study", type: "define-study",
        study: {
          id: "link-static", kind: "structural-linear", bodyIds: ["link-body"], materialId: "al-6061",
          supports: ["fixed-end"], loads: [{ selectionId: "tip", forceN: [0, -500, 0] }],
        },
      },
    ],
  });
  if (!applied.ok) throw new Error("Expected solve document setup to succeed");
  return applied.document;
}

async function solveRequest() {
  const document = await solveDocument();
  const artifact = await defineArtifactRecord({
    kind: "solver-mesh",
    sourceRevision: document.revision,
    producer: { name: "structural-mesher", version: "1" },
    settingsDigest: "c".repeat(64),
    contentDigest: "d".repeat(64),
    units: "m",
    mediaType: "application/x-structural-mesh",
    dependencies: [{ kind: "entity", reference: "body:link-body" }],
  });
  return {
    jobId: "link-static-job",
    kind: "fea" as const,
    sourceRevision: document.revision,
    inputArtifacts: [structuredClone(artifact)],
    settings: { solver: "linear" },
    studyId: "link-static",
    input: { voxelSizeM: 0.001 },
    document: structuredClone(document),
  };
}

describe("Engineering solve request contract", () => {
  it("accepts a structured-cloned verified artifact", async () => {
    const request = await solveRequest();

    await expect(defineEngineeringSolveRequest(request)).resolves.toMatchObject(request);
  });

  it("rejects a fabricated input artifact ID", async () => {
    const request = await solveRequest();
    const fabricated = {
      ...request,
      inputArtifacts: [{ ...request.inputArtifacts[0]!, id: "f".repeat(64) }],
    };

    await expect(defineEngineeringSolveRequest(fabricated)).rejects.toThrow(/artifact id does not match canonical content/i);
  });

  it("rejects tampered document content and source revisions", async () => {
    const request = await solveRequest();

    await expect(defineEngineeringSolveRequest({
      ...request,
      document: { ...request.document, label: "Tampered link" },
    })).rejects.toThrow(/revision/i);
    await expect(defineEngineeringSolveRequest({
      ...request,
      sourceRevision: "f".repeat(64),
    })).rejects.toThrow(/source revision/i);
  });
});
