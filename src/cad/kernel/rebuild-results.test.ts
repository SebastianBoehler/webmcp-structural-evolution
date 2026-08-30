import { describe, expect, it } from "vitest";

import { applyDesignSessionTransaction, createDesignSession } from "../design-session";
import { createDesignDocument } from "../document-schema";
import { defineCadEvaluationRequest } from "../runtime-contracts";
import { buildCadEvaluationResults } from "./rebuild-results";

describe("exact rebuild result ownership", () => {
  it("binds every aggregate exact artifact to document body-collection membership", async () => {
    const document = await createDesignDocument({
      id: "aggregate-part", label: "Aggregate part",
      units: { length: "mm", angle: "deg", mass: "kg" },
      createdBy: { kind: "agent", id: "test" },
    });
    const request = await defineCadEvaluationRequest({
      requestId: "aggregate-results", document, sourceRevision: document.revision,
      requestedOutputs: ["brep", "semantic-mesh", "step"], settings: {},
    });
    const mesh = {
      positionsM: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(),
      faces: [], triangleFaceIndices: new Uint32Array(), edgePointsM: new Float32Array(),
      edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
    };

    const results = await buildCadEvaluationResults(request, {
      featureIds: [], bodyIds: [], brep: { bytes: new Uint8Array([1]) }, semanticMesh: mesh,
      step: { bytes: new Uint8Array([2]) },
    });

    expect(results.filter((result) => "artifact" in result).every((result) =>
      "artifact" in result && result.artifact.dependencies.some((dependency) =>
        dependency.kind === "entity" && dependency.reference === "document:aggregate-part")))
      .toBe(true);
  });

  it("invalidates a one-body aggregate artifact when a second body is defined", async () => {
    const root = await createDesignDocument({
      id: "body-set", label: "Body set", units: { length: "mm", angle: "deg", mass: "kg" },
      createdBy: { kind: "agent", id: "test" },
    });
    const clock = { now: () => "2026-08-31T00:00:00.000Z", elapsedMs: () => 0 };
    const first = await applyDesignSessionTransaction(createDesignSession(root), {
      id: "first-body", expectedRevision: root.revision,
      actor: { kind: "agent", id: "test" }, preconditions: [], commands: [
        { id: "first-sketch", type: "define-sketch", sketch: { id: "first-sketch", plane: "frame:world", entities: [{ id: "first-outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.01, 0.01] }], constraints: [] } },
        { id: "first-feature", type: "define-feature", feature: { id: "first-feature", kind: "extrude", sketchId: "first-sketch", distanceM: 0.01 } },
        { id: "first-body-command", type: "define-body", body: { id: "first-body", featureId: "first-feature" } },
      ],
    }, clock);
    if (!first.result.ok) throw new Error("Expected first body authoring to succeed");
    const request = await defineCadEvaluationRequest({
      requestId: "one-body", document: first.result.document,
      sourceRevision: first.result.document.revision, requestedOutputs: ["brep"], settings: {},
    });
    const [brep] = await buildCadEvaluationResults(request, {
      featureIds: ["first-feature"], bodyIds: ["first-body"], brep: { bytes: new Uint8Array([1]) },
    });
    if (!brep || !("artifact" in brep)) throw new Error("Expected BREP artifact");
    const session = createDesignSession(first.result.document, [brep.artifact]);

    const second = await applyDesignSessionTransaction(session, {
      id: "second-body", expectedRevision: first.result.document.revision,
      actor: { kind: "agent", id: "test" }, preconditions: [], commands: [
        { id: "second-sketch", type: "define-sketch", sketch: { id: "second-sketch", plane: "frame:world", entities: [{ id: "second-outline", kind: "circle", centerM: [0.03, 0], radiusM: 0.005 }], constraints: [] } },
        { id: "second-feature", type: "define-feature", feature: { id: "second-feature", kind: "extrude", sketchId: "second-sketch", distanceM: 0.01 } },
        { id: "second-body-command", type: "define-body", body: { id: "second-body", featureId: "second-feature" } },
      ],
    }, clock);

    expect(second.result.ok).toBe(true);
    expect(second.session.artifacts.invalidatedIds).toEqual([brep.artifact.id]);
    expect(second.session.artifacts.index.artifacts).toEqual([]);
  });
});
