// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { BodyDynamicsPayload } from "../cad/body-dynamics-payload";
import { defineArtifactRecord } from "../cad/artifact-contract";
import { defineCadEvaluationRequest, type CadKernelAdapter } from "../cad/runtime-contracts";
import { buildCadEvaluationResults } from "../cad/kernel/rebuild-results";
import { sourceDocument } from "../engineering/job-runner-test-fixtures";
import { acquireExactComponentSource } from "./exact-component-source";

describe("exact component source", () => {
  it("acquires owned BREP, semantic mesh, and body dynamics in one OCCT evaluation", async () => {
    const document = await sourceDocument();
    const semanticMesh = {
      positionsM: new Float32Array([0, 0, 0, .1, 0, 0, 0, .02, 0]),
      normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
      faces: [{ id: "face:link-body:fixed", bodyId: "link-body", signature: {
        ownerFeatureId: "link-feature", kind: "face" as const, geometry: "plane" as const,
        centroidM: [0, .01, 0] as [number, number, number], measureSI: .002,
        adjacentKinds: [] as string[],
      }, surfaceEvidence: { kind: "plane" as const, normal: [0, 0, 1] as [number, number, number] } }],
      triangleFaceIndices: new Uint32Array([0]), edgePointsM: new Float32Array(),
      edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
    };
    const dynamics: BodyDynamicsPayload = { bodies: [{
      bodyId: "link-body", brep: { bytes: Uint8Array.of(1, 2, 3) }, volumeM3: 2e-5,
      centerOfMassM: [.05, .01, .005],
      centroidalInertiaUnitDensityKgM2: [1, 0, 0, 0, 2, 0, 0, 0, 3],
    }] };
    const evaluate = vi.fn<CadKernelAdapter["evaluate"]>(async (request, _signal, emit) => {
      emit({ requestId: request.requestId, state: "succeeded",
        sourceRevision: request.sourceRevision, requestedOutputs: [...request.requestedOutputs],
        results: await buildCadEvaluationResults(request, {
          featureIds: document.features.map(({ id }) => id),
          bodyIds: document.bodies.map(({ id }) => id),
          brep: { bytes: Uint8Array.of(1, 2, 3) },
          semanticMesh, bodyDynamics: dynamics,
        }) });
    });
    const adapter: CadKernelAdapter = { evaluate, importStep: async () => { throw new Error("unused"); } };

    const source = await acquireExactComponentSource(document, adapter, new AbortController().signal);

    expect(evaluate).toHaveBeenCalledOnce();
    expect(source.document.revision).toBe(document.revision);
    expect(source.artifacts.map(({ kind }) => kind).sort()).toEqual(["brep", "render-mesh"]);
    expect(source.allArtifacts.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
      "brep", "render-mesh", "body-dynamics",
    ]));
    expect(source.bodyDynamics.bodies.map(({ bodyId }) => bodyId)).toEqual(["link-body"]);
    const first = source.brepPayload.bytes[0];
    source.brepPayload.bytes[0] = 255;
    expect(source.brepPayload.bytes[0]).toBe(first);
  });

  it("rejects an exact root owned by a different active document", async () => {
    const document = await sourceDocument();
    const semanticMesh = {
      positionsM: new Float32Array([0, 0, 0, .1, 0, 0, 0, .02, 0]),
      normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
      faces: [{ id: "face:link-body:fixed", bodyId: "link-body", signature: {
        ownerFeatureId: "link-feature", kind: "face" as const, geometry: "plane" as const,
        centroidM: [0, .01, 0] as [number, number, number], measureSI: .002,
        adjacentKinds: [] as string[],
      }, surfaceEvidence: { kind: "plane" as const,
        normal: [0, 0, 1] as [number, number, number] } }],
      triangleFaceIndices: new Uint32Array([0]), edgePointsM: new Float32Array(),
      edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
    };
    const dynamics: BodyDynamicsPayload = { bodies: [{
      bodyId: "link-body", brep: { bytes: Uint8Array.of(1) }, volumeM3: 1,
      centerOfMassM: [0, 0, 0],
      centroidalInertiaUnitDensityKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }] };
    const adapter: CadKernelAdapter = { async evaluate(request, _signal, emit) {
      const results = await buildCadEvaluationResults(request, {
        featureIds: document.features.map(({ id }) => id),
        bodyIds: document.bodies.map(({ id }) => id),
        brep: { bytes: Uint8Array.of(1) }, semanticMesh, bodyDynamics: dynamics,
      });
      const brep = results.find(({ output }) => output === "brep")!;
      if (brep.output !== "brep") throw new Error("BREP fixture missing");
      const wrong = await defineArtifactRecord({ ...brep.artifact, id: undefined,
        dependencies: [{ kind: "entity", reference: "document:other-document" }] });
      emit({ requestId: request.requestId, state: "succeeded", sourceRevision: request.sourceRevision,
        requestedOutputs: [...request.requestedOutputs],
        results: results.map((result) => result === brep ? { ...brep, artifact: wrong } : result) });
    }, async importStep() { throw new Error("unused"); } };

    await expect(acquireExactComponentSource(document, adapter, new AbortController().signal))
      .rejects.toThrow(/active document revision/i);
  });
});
