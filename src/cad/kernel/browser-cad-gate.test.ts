import { describe, expect, it } from "vitest";

import { defineArtifactRecord, type ArtifactRecord } from "../artifact-contract";
import { digestCadOutputPayload, type SemanticMeshPayload } from "../rebuild-payload";
import type { CadEvaluationEvent, CadKernelAdapter } from "../runtime-contracts";
import {
  runExactCadGate,
  type ExactCadGateDependencies,
} from "./browser-cad-gate";

type Failure = "missing" | "invalid-solid" | "mass" | "volume" | "step" | "stale" | "late-success";

const semanticMesh: SemanticMeshPayload = {
  positionsM: new Float32Array([-0.05, -0.02, 0, 0.05, -0.02, 0, 0.05, 0.02, 0.02]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  faces: [{
    id: "face-1", bodyId: "finished-body",
    signature: {
      ownerFeatureId: "through-cut", kind: "face", geometry: "plane",
      centroidM: [0, 0, 0.01], measureSI: 0.001, adjacentKinds: [],
    },
  }],
  triangleFaceIndices: new Uint32Array([0]),
  edgePointsM: new Float32Array([0, 0, 0, 0.01, 0, 0]),
  edgePointRanges: new Uint32Array([0, 2]),
  edges: [{
    id: "edge-1", bodyId: "finished-body",
    signature: {
      ownerFeatureId: "through-cut", kind: "edge", geometry: "curve",
      centroidM: [0.005, 0, 0], measureSI: 0.01, adjacentKinds: [],
    },
  }],
  polylineEdgeIndices: new Uint32Array([0]),
};

const expectedVolume = (widthM: number) => widthM * 0.04 * 0.01
  + Math.PI * 0.01 ** 2 * 0.01
  - Math.PI * 0.003 ** 2 * 0.02;

async function artifact(
  kind: "brep" | "render-mesh" | "export",
  revision: string,
  contentDigest: string,
): Promise<ArtifactRecord> {
  return defineArtifactRecord({
    kind,
    sourceRevision: revision,
    producer: { name: "test-occt", version: "1" },
    settingsDigest: "a".repeat(64),
    contentDigest,
    units: kind === "export" ? "mm" : "m",
    mediaType: kind === "brep" ? "application/vnd.opencascade.brep"
      : kind === "render-mesh" ? "application/vnd.structural-evolution.semantic-mesh"
        : "model/step",
    dependencies: [{ kind: "entity", reference: "parameter:plate-width" }],
  });
}

async function successEvent(
  requestId: string,
  revision: string,
  widthM: number,
  failure?: Failure,
): Promise<CadEvaluationEvent> {
  const brep = { bytes: new Uint8Array([widthM * 1_000, 2, 3]) };
  const step = { bytes: new TextEncoder().encode(`STEP-${widthM}`) };
  const staleRevision = failure === "stale" && requestId !== "initial" ? "f".repeat(64) : revision;
  const results = [
    { output: "brep" as const, artifact: await artifact("brep", staleRevision, await digestCadOutputPayload(brep)), payload: brep },
    { output: "semantic-mesh" as const, artifact: await artifact("render-mesh", staleRevision, await digestCadOutputPayload(semanticMesh)), payload: semanticMesh },
    {
      output: "mass-properties" as const,
      payload: {
        densityKgM3: 1,
        volumeM3: failure === "volume" ? expectedVolume(widthM) * 1.000002 : expectedVolume(widthM),
        surfaceAreaM2: 0.01,
        massKg: failure === "mass" ? expectedVolume(widthM) * 1.000002 : expectedVolume(widthM),
        centerOfMassM: [0, 0, 0.01] as const,
        inertiaKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
      },
    },
    { output: "step" as const, artifact: await artifact("export", staleRevision, await digestCadOutputPayload(step)), payload: step },
  ];
  return {
    requestId,
    state: "succeeded",
    requestedOutputs: ["brep", "semantic-mesh", "mass-properties", "step"],
    results: failure === "missing" ? results.filter(({ output }) => output !== "step") : results,
  } as CadEvaluationEvent;
}

function dependencies(failure?: Failure): ExactCadGateDependencies {
  let call = 0;
  const adapter: CadKernelAdapter = {
    async evaluate(request, _signal, emit) {
      call += 1;
      if (failure === "invalid-solid" && call === 1) {
        emit({
          requestId: request.requestId, state: "failed",
          error: { code: "invalid-solid", message: "invalid solid from OCCT" },
        });
        return;
      }
      if (call === 3) {
        emit({ requestId: request.requestId, state: "cancelled" });
        if (failure === "late-success") emit(await successEvent(request.requestId, request.sourceRevision, 0.1));
        return;
      }
      emit(await successEvent(
        request.requestId,
        request.sourceRevision,
        call === 1 ? 0.08 : 0.1,
        call <= 2 ? failure : undefined,
      ));
    },
  };
  return {
    createAdapter: () => adapter,
    decodeStep: async () => ({
      surfaces: [{ name: "round-trip", positions: new Float32Array([0, 0, 0]), indices: new Uint32Array([0, 0, 0]) }],
      sizeMm: failure === "step" ? [100.0002, 40, 20] : [100, 40, 20],
      triangleCount: 1,
    }),
    now: (() => { let tick = 0; return () => ++tick; })(),
  };
}

describe("browser exact-CAD gate", () => {
  it("authors, edits, cancels, round trips, and completes digest-bound exact rebuilds", async () => {
    const result = await runExactCadGate(new AbortController().signal, dependencies());

    expect(result.status).toBe("passed");
    expect(result.hashes.initialBrep).not.toBe(result.hashes.dimensionBrep);
    expect(result.measurements.maximumMassRelativeError).toBeLessThanOrEqual(1e-6);
    expect(result.measurements.maximumVolumeRelativeError).toBeLessThanOrEqual(1e-6);
    expect(result.stepRoundTrip.envelopeRelativeError).toBeLessThanOrEqual(1e-6);
    expect(result.cancellation).toEqual({ outcome: "cancelled", lateSuccess: false });
    expect(result.artifacts).toMatchObject({ staleCount: 0, invalidatedCount: 3 });
    expect(result.renderMesh.triangleCount).toBe(1);
  });

  it.each([
    ["missing", /missing requested output/i],
    ["invalid-solid", /invalid solid count: 1/i],
    ["mass", /mass relative error/i],
    ["volume", /volume relative error/i],
    ["step", /STEP envelope relative error/i],
    ["stale", /stale CAD artifact/i],
    ["late-success", /success after cancellation/i],
  ] as const)("rejects %s gate evidence", async (failure, message) => {
    await expect(runExactCadGate(
      new AbortController().signal,
      dependencies(failure),
    )).rejects.toThrow(message);
  });
});
