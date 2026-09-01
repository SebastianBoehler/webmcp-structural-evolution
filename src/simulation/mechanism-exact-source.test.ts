import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CadEvaluationEvent, CadEvaluationRequest } from "../cad/runtime-contracts";
import { defineCadEvaluationRequest } from "../cad/runtime-contracts";
import { CAD_RESOURCE_LIMITS } from "../cad/cad-resource-limits";
import { createArtifactIndex, defineArtifactRecord } from "../cad/artifact-contract";
import {
  bodyDynamics, exactSourceDocument, exactSuccess, semanticMesh,
} from "./mechanism-exact-source.test-support";

const worker = vi.hoisted(() => ({ evaluateMechanismExactRequest: vi.fn() }));
vi.mock("./mechanism-exact-worker", () => worker);

import { rebuildMechanismExactSource } from "./mechanism-exact-source";

type Emit = (event: CadEvaluationEvent) => void;
type Evaluate = (request: CadEvaluationRequest, signal: AbortSignal, emit: Emit) => Promise<void>;

const succeed: Evaluate = async (request, _signal, emit) => {
  emit({ requestId: request.requestId, state: "progress", progress: 0.5 });
  emit(await exactSuccess(request));
};

function delayNextArtifactDigest() {
  const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let release: () => void = () => undefined;
  let signalStarted: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let delayed = false;
  const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (
    algorithm, data,
  ) => {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    if (!delayed && new TextDecoder().decode(bytes).includes("occt-wasm")) {
      delayed = true;
      signalStarted();
      await gate;
    }
    return originalDigest(algorithm, data);
  });
  return { release, spy, started };
}

beforeEach(() => {
  worker.evaluateMechanismExactRequest.mockReset();
  worker.evaluateMechanismExactRequest.mockImplementation(succeed);
});

describe("private mechanism exact-source authority", () => {
  it("issues one deeply frozen same-request exact source from a canonical document", async () => {
    const document = await exactSourceDocument();
    const source = await rebuildMechanismExactSource(document, new AbortController().signal);

    expect(source.brepArtifact.sourceRevision).toBe(document.revision);
    expect(source.semanticArtifact.sourceRevision).toBe(document.revision);
    expect(source.bodyDynamics.bodies.map(({ bodyId }) => bodyId)).toEqual(["body"]);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.brepArtifact)).toBe(true);
    expect(Object.isFrozen(source.bodyDynamics)).toBe(true);
    expect(Object.isFrozen(source.bodyDynamics.bodies)).toBe(true);
    expect(Object.isFrozen(source.bodyDynamics.bodies[0])).toBe(true);
    expect(() => createArtifactIndex(document.revision, [
      source.brepArtifact, source.semanticArtifact,
    ])).not.toThrow();
    const firstBrep = source.brepPayload;
    const firstBodyDynamics = source.bodyDynamics;
    firstBrep.bytes[0] = 99;
    firstBodyDynamics.bodies[0]!.brep.bytes[0] = 99;
    expect(source.brepPayload.bytes[0]).toBe(1);
    expect(source.bodyDynamics.bodies[0]!.brep.bytes[0]).toBe(4);
    const [request] = worker.evaluateMechanismExactRequest.mock.calls[0]!;
    expect(request).toMatchObject({
      sourceRevision: document.revision,
      requestedOutputs: ["brep", "semantic-mesh", "body-dynamics"],
      settings: { consumer: "mechanism-exact-source-v1" },
    });
    expect(worker.evaluateMechanismExactRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong request", async (request: CadEvaluationRequest, emit: Emit) => emit({
      ...(await exactSuccess(request)), requestId: "wrong-request",
    })],
    ["wrong revision", async (request: CadEvaluationRequest, emit: Emit) => emit({
      ...(await exactSuccess(request)), sourceRevision: "f".repeat(64),
    })],
    ["missing output", async (request: CadEvaluationRequest, emit: Emit) => {
      const success = await exactSuccess(request);
      emit({ ...success, results: success.results.filter(({ output }) => output !== "body-dynamics") } as CadEvaluationEvent);
    }],
    ["duplicate terminal", async (request: CadEvaluationRequest, emit: Emit) => {
      emit(await exactSuccess(request));
      emit(await exactSuccess(request));
    }],
    ["partial only", async (request: CadEvaluationRequest, emit: Emit) => {
      emit({ requestId: request.requestId, state: "progress", progress: 0.75 });
    }],
  ])("rejects %s worker evidence", async (_label, produce) => {
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: Emit,
    ) => produce(request, emit));
    await expect(rebuildMechanismExactSource(
      await exactSourceDocument(), new AbortController().signal,
    )).rejects.toThrow(/exact mechanism rebuild|same-request|terminal|output/i);
  });

  it.each([
    ["non-SPD", bodyDynamics({
      centroidalInertiaUnitDensityKgM2: [1, 2, 0, 2, 1, 0, 0, 0, 1],
    })],
    ["nonfinite", bodyDynamics({ volumeM3: Number.POSITIVE_INFINITY })],
    ["duplicate", { bodies: [...bodyDynamics().bodies, ...bodyDynamics().bodies] }],
  ])("rejects %s dynamics without issuing an exact source", async (_label, dynamics) => {
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: Emit,
    ) => emit({
      requestId: request.requestId, state: "succeeded",
      sourceRevision: request.sourceRevision, requestedOutputs: [...request.requestedOutputs],
      results: [
        { ...(await exactSuccess(request)).results[0] },
        { ...(await exactSuccess(request)).results[1] },
        { output: "body-dynamics", payload: dynamics },
      ],
    } as CadEvaluationEvent));
    await expect(rebuildMechanismExactSource(
      await exactSourceDocument(), new AbortController().signal,
    )).rejects.toThrow();
  });

  it("rejects oversized body BREP evidence", async () => {
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: Emit,
    ) => {
      const success = await exactSuccess(request);
      emit({
        ...success,
        results: success.results.map((result) => result.output === "body-dynamics"
          ? { ...result, payload: bodyDynamics({
            brep: { bytes: new Uint8Array(CAD_RESOURCE_LIMITS.bodyDynamicsBrepBytes + 1) },
          }) }
          : result),
      } as CadEvaluationEvent);
    });
    await expect(rebuildMechanismExactSource(
      await exactSourceDocument(), new AbortController().signal,
    )).rejects.toThrow(/BREP bytes|mechanism exact source bytes/i);
  });

  it("rejects exact artifacts without complete document and body lineage", async () => {
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: Emit,
    ) => {
      const success = await exactSuccess(request);
      const brep = success.results.find(({ output }) => output === "brep")!;
      if (!("artifact" in brep)) throw new Error("Expected BREP artifact");
      const unbound = await defineArtifactRecord({
        kind: brep.artifact.kind, sourceRevision: brep.artifact.sourceRevision,
        producer: brep.artifact.producer, settingsDigest: brep.artifact.settingsDigest,
        contentDigest: brep.artifact.contentDigest, units: brep.artifact.units,
        mediaType: brep.artifact.mediaType, dependencies: [],
      });
      emit({
        ...success,
        results: success.results.map((result) => result.output === "brep"
          ? { ...result, artifact: unbound }
          : result),
      });
    });
    await expect(rebuildMechanismExactSource(
      await exactSourceDocument(), new AbortController().signal,
    )).rejects.toThrow(/lineage/i);
  });

  it("cancels before launch and during worker execution", async () => {
    const before = new AbortController();
    before.abort();
    await expect(rebuildMechanismExactSource(await exactSourceDocument(), before.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(worker.evaluateMechanismExactRequest).not.toHaveBeenCalled();

    let started: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, signal: AbortSignal, emit: Emit,
    ) => {
      started();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      emit({ requestId: request.requestId, state: "cancelled", workerDisposition: "quarantined" });
    });
    const during = new AbortController();
    const pending = rebuildMechanismExactSource(await exactSourceDocument(), during.signal);
    await ready;
    during.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels while asynchronous terminal artifact validation settles", async () => {
    const document = await exactSourceDocument();
    const fixtureRequest = await defineCadEvaluationRequest({
      requestId: "terminal-validation-fixture",
      document,
      sourceRevision: document.revision,
      requestedOutputs: ["brep", "semantic-mesh", "body-dynamics"],
      settings: { consumer: "mechanism-exact-source-v1" },
    });
    const fixture = await exactSuccess(fixtureRequest);
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: Emit,
    ) => emit({
      ...fixture,
      requestId: request.requestId,
      sourceRevision: request.sourceRevision,
      requestedOutputs: [...request.requestedOutputs],
    }));
    const delayed = delayNextArtifactDigest();
    const controller = new AbortController();
    try {
      const pending = rebuildMechanismExactSource(document, controller.signal);
      await delayed.started;
      controller.abort();
      delayed.release();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      delayed.release();
      delayed.spy.mockRestore();
    }
  });

  it("rejects caller-supplied authority fields and exposes no raw issuance helper", async () => {
    const document = await exactSourceDocument();
    await expect(rebuildMechanismExactSource({
      ...document, brepArtifact: { kind: "brep" }, bodyDynamics: bodyDynamics(), semanticMesh: semanticMesh(),
    } as never, new AbortController().signal)).rejects.toThrow();
    expect(Object.keys(await import("./mechanism-exact-source")).sort())
      .toEqual(["rebuildMechanismExactSource"]);
  });
});
