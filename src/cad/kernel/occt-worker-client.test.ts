import { describe, expect, it, vi } from "vitest";

import { defineArtifactRecord } from "../artifact-contract";
import { createDesignDocument } from "../document-schema";
import { digestCadOutputPayload } from "../rebuild-payload";
import {
  CadEvaluationRequestSchema,
  ExactStepImportRequestSchema,
  type CadEvaluationEvent,
  type CadEvaluationRequest,
  type ExactStepImportRequest,
} from "../runtime-contracts";
import { createOcctBridge } from "./occt-bridge";
import {
  createOcctWorkerClient,
  type OcctWorkerLike,
  type OcctWorkerMessageEvent,
} from "./occt-worker-client";
import {
  OcctWorkerEventSchema,
  type OcctWorkerRequest,
} from "./occt-worker-contract";

const massProperties = {
  densityKgM3: 1, volumeM3: 1, surfaceAreaM2: 1, massKg: 1,
  centerOfMassM: [0, 0, 0], inertiaKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};
const emptySections = {
  pointsM: new Float32Array(), curvePointRanges: new Uint32Array(), curveIds: [],
};
const requestRevisions = new Map<string, string>();

async function request(requestId: string): Promise<CadEvaluationRequest> {
  const document = await createDesignDocument({
    id: "part",
    label: "Part",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "agent", id: "test" },
  });
  const parsed = CadEvaluationRequestSchema.parse({
    requestId,
    document,
    sourceRevision: document.revision,
    requestedOutputs: ["mass-properties"],
    settings: {},
  });
  requestRevisions.set(requestId, parsed.sourceRevision);
  return parsed;
}

const revisionFor = (requestId: string) => requestRevisions.get(requestId)!;

async function stepRequest(requestId: string): Promise<ExactStepImportRequest> {
  const sourceRevision = "e".repeat(64);
  const payload = { bytes: new TextEncoder().encode("ISO-10303-21") };
  const artifact = await defineArtifactRecord({
    kind: "export", sourceRevision,
    producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: "a".repeat(64),
    contentDigest: await digestCadOutputPayload(payload), units: "mm", mediaType: "model/step",
    dependencies: [],
  });
  return ExactStepImportRequestSchema.parseAsync({
    requestId, sourceRevision, step: { artifact, payload }, settings: {},
  });
}

class ControlledWorker implements OcctWorkerLike {
  readonly posted: OcctWorkerRequest[] = [];
  terminateCount = 0;
  private readonly listeners = new Set<(event: OcctWorkerMessageEvent) => void>();

  postMessage(message: unknown): void {
    this.posted.push(message as OcctWorkerRequest);
  }

  addEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  emit(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }
}

describe("OCCT worker client", () => {
  it("disposes the owned kernel once and rejects later access", () => {
    let disposals = 0;
    const kernel = { [Symbol.dispose]: () => { disposals += 1; } };
    const bridge = createOcctBridge(kernel);

    expect(bridge.withKernel((owned) => owned === kernel)).toBe(true);
    bridge.dispose();
    bridge.dispose();

    expect(disposals).toBe(1);
    expect(() => bridge.withKernel(() => undefined)).toThrow(/disposed/i);
  });

  it.each([
    ["invalid-document", "invalid-document"],
    ["initialization-failed", "internal-error"],
    ["memory-exhausted", "resource-limit"],
    ["feature-failed", "feature-failed"],
    ["invalid-solid", "invalid-solid"],
    ["reference-requires-repair", "reference-requires-repair"],
  ] as const)("maps %s into a typed CAD failure", async (workerCode, cadCode) => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const evaluation = client.evaluate(await request("mapped"), new AbortController().signal, (event) => events.push(event));

    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.emit({
      type: "failed",
      requestId: "mapped",
      error: { code: workerCode, message: "kernel stopped" },
    });
    await evaluation;

    expect(events).toEqual([{
      requestId: "mapped",
      state: "failed",
      error: { code: cadCode, message: "kernel stopped" },
    }]);
    expect(worker.terminateCount).toBe(0);
  });

  it("preserves affected consumers on persistent-reference failures", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const evaluation = client.evaluate(
      await request("repair"), new AbortController().signal, (event) => events.push(event),
    );

    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.emit({
      type: "failed", requestId: "repair",
      error: {
        code: "reference-requires-repair", message: "ambiguous face",
        affectedConsumers: ["named-selection:mount-face", "mate:mount-mate"],
      },
    });
    await evaluation;

    expect(events[0]).toMatchObject({
      state: "failed",
      error: {
        code: "reference-requires-repair",
        affectedConsumers: ["named-selection:mount-face", "mate:mount-mate"],
      },
    });
  });

  it("fails the active request and replaces the worker after a protocol mismatch", async () => {
    const workers = [new ControlledWorker(), new ControlledWorker()];
    let factoryCalls = 0;
    const client = createOcctWorkerClient(() => workers[factoryCalls++]!);
    const events: CadEvaluationEvent[] = [];
    const first = client.evaluate(await request("first"), new AbortController().signal, (event) => events.push(event));

    await vi.waitFor(() => expect(workers[0]!.posted).toHaveLength(1));
    workers[0]!.emit({ type: "progress", requestId: "someone-else", progress: 0.5 });
    await first;
    const second = client.evaluate(await request("second"), new AbortController().signal, (event) => events.push(event));

    expect(events[0]).toMatchObject({
      requestId: "first",
      state: "failed",
      error: { code: "internal-error" },
    });
    expect(workers[0]!.terminateCount).toBe(1);
    await vi.waitFor(() => expect(workers[1]!.posted).toHaveLength(1));
    expect(factoryCalls).toBe(2);
    workers[1]!.emit({ type: "cancelled", requestId: "second" });
    await second;
  });

  it("quarantines an aborted worker before completion and isolates arbitrarily late success", async () => {
    vi.useFakeTimers();
    try {
      const workers = [new ControlledWorker(), new ControlledWorker()];
      let factoryCalls = 0;
      const client = createOcctWorkerClient(() => workers[factoryCalls++]!);
      const events: CadEvaluationEvent[] = [];
      const terminationCountAtCancellation: number[] = [];
      const controller = new AbortController();
      const first = client.evaluate(
        await request("cancelled"), controller.signal, (event) => {
          events.push(event);
          if (event.state === "cancelled") {
            terminationCountAtCancellation.push(workers[0]!.terminateCount);
          }
        },
      );

      await vi.waitFor(() => expect(workers[0]!.posted).toHaveLength(1));
      controller.abort();
      await first;
      expect(workers[0]!.terminateCount).toBe(1);
      expect(workers[0]!.listenerCount).toBe(0);
      expect(events).toContainEqual({
        requestId: "cancelled", state: "cancelled", workerDisposition: "quarantined",
      });
      expect(terminationCountAtCancellation).toEqual([1]);

      const second = client.evaluate(
        await request("following"), new AbortController().signal, (event) => events.push(event),
      );
      await vi.waitFor(() => expect(workers[1]!.posted).toHaveLength(1));
      setTimeout(() => workers[0]!.emit({
        type: "succeeded", requestId: "cancelled",
        sourceRevision: revisionFor("cancelled"),
        requestedOutputs: ["mass-properties"],
        results: [{ output: "mass-properties", payload: massProperties }],
      }), 60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      workers[1]!.emit({
        type: "succeeded", requestId: "following",
        sourceRevision: revisionFor("following"),
        requestedOutputs: ["mass-properties"],
        results: [{ output: "mass-properties", payload: massProperties }],
      });
      await second;

      expect(factoryCalls).toBe(2);
      expect(workers[1]!.terminateCount).toBe(0);
      expect(events.filter(({ requestId }) => requestId === "cancelled"))
        .toHaveLength(1);
      expect(events.at(-1)?.state).toBe("succeeded");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses a worker after an ordinary typed failure", async () => {
    const worker = new ControlledWorker();
    let factoryCalls = 0;
    const client = createOcctWorkerClient(() => { factoryCalls += 1; return worker; });
    const first = client.evaluate(await request("failed"), new AbortController().signal, () => undefined);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.emit({ type: "failed", requestId: "failed", error: { code: "feature-failed", message: "bad feature" } });
    await first;
    const second = client.evaluate(await request("following"), new AbortController().signal, () => undefined);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
    worker.emit({
      type: "succeeded", requestId: "following", sourceRevision: revisionFor("following"),
      requestedOutputs: ["mass-properties"],
      results: [{ output: "mass-properties", payload: massProperties }],
    });
    await second;

    expect(factoryCalls).toBe(1);
    expect(worker.terminateCount).toBe(0);
  });

  it("rejects malformed worker messages as protocol failures", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const evaluation = client.evaluate(await request("malformed"), new AbortController().signal, (event) => events.push(event));

    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.emit({ type: "succeeded", requestId: "malformed", results: [] });
    await evaluation;

    expect(events[0]).toMatchObject({
      requestId: "malformed",
      state: "failed",
      error: { code: "internal-error" },
    });
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects a self-consistent success for outputs the active request did not ask for", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const evaluation = client.evaluate(
      await request("wrong-outputs"),
      new AbortController().signal,
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.emit({
      type: "succeeded",
      requestId: "wrong-outputs",
      sourceRevision: revisionFor("wrong-outputs"),
      requestedOutputs: ["section-curves"],
      results: [{ output: "section-curves", payload: emptySections }],
    });
    await evaluation;

    expect(events[0]).toMatchObject({
      requestId: "wrong-outputs",
      state: "failed",
      error: { code: "internal-error" },
    });
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects a self-consistent success for a stale source revision", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const evaluation = client.evaluate(
      await request("stale-success"), new AbortController().signal, (event) => events.push(event),
    );

    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.emit({
      type: "succeeded", requestId: "stale-success", sourceRevision: "f".repeat(64),
      requestedOutputs: ["mass-properties"],
      results: [{ output: "mass-properties", payload: massProperties }],
    });
    await evaluation;

    expect(events[0]).toMatchObject({
      requestId: "stale-success", state: "failed", error: { code: "internal-error" },
    });
    expect(worker.terminateCount).toBe(1);
  });

  it("gives the first terminal event ownership while success validation settles", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const originalParse = OcctWorkerEventSchema.safeParseAsync.bind(OcctWorkerEventSchema);
    let releaseValidation: () => void = () => undefined;
    let markValidationStarted: () => void = () => undefined;
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
    const validationStarted = new Promise<void>((resolve) => { markValidationStarted = resolve; });
    vi.spyOn(OcctWorkerEventSchema, "safeParseAsync").mockImplementationOnce(async (value) => {
      markValidationStarted();
      await validationGate;
      return originalParse(value);
    });
    const first = client.evaluate(
      await request("first"),
      new AbortController().signal,
      (event) => events.push(event),
    );
    const second = client.evaluate(
      await request("second"),
      new AbortController().signal,
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.emit({
      type: "succeeded",
      requestId: "first",
      sourceRevision: revisionFor("first"),
      requestedOutputs: ["mass-properties"],
      results: [{ output: "mass-properties", payload: massProperties }],
    });
    await validationStarted;
    worker.emit({ type: "cancelled", requestId: "first" });
    releaseValidation();

    await vi.waitFor(() => {
      expect(events.filter((event) => event.requestId === "first").map((event) => event.state))
        .toEqual(["succeeded"]);
    });
    await first;
    await vi.waitFor(() => expect(worker.posted.filter((message) =>
      message.type === "evaluate").map((message) => message.request.requestId))
      .toEqual(["first", "second"]));
    worker.emit({
      type: "succeeded",
      requestId: "second",
      sourceRevision: revisionFor("second"),
      requestedOutputs: ["mass-properties"],
      results: [{ output: "mass-properties", payload: massProperties }],
    });
    await second;

    expect(events.filter((event) => event.requestId === "second").map((event) => event.state))
      .toEqual(["succeeded"]);
    expect(worker.terminateCount).toBe(0);
  });

  it("validates content-addressed B-rep success events asynchronously", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const evaluationRequest = await request("brep");
    const brepRequest = CadEvaluationRequestSchema.parse({
      ...evaluationRequest,
      requestedOutputs: ["brep"],
    });
    const payload = { bytes: new Uint8Array([0x42, 0x52, 0x45, 0x50]) };
    const artifact = await defineArtifactRecord({
      kind: "brep",
      sourceRevision: brepRequest.sourceRevision,
      producer: { name: "occt-wasm", version: "4.3.2" },
      settingsDigest: "a".repeat(64),
      contentDigest: await digestCadOutputPayload(payload),
      units: "m",
      mediaType: "application/vnd.opencascade.brep",
      dependencies: [],
    });
    const evaluation = client.evaluate(
      brepRequest,
      new AbortController().signal,
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.emit({
      type: "succeeded",
      requestId: "brep",
      sourceRevision: brepRequest.sourceRevision,
      requestedOutputs: ["brep"],
      results: [{ output: "brep", artifact, payload }],
    });
    await evaluation;

    expect(events).toEqual([{
      requestId: "brep",
      state: "succeeded",
      sourceRevision: brepRequest.sourceRevision,
      requestedOutputs: ["brep"],
      results: [{ output: "brep", artifact, payload }],
    }]);
  });

  it("imports STEP through the serialized worker boundary and validates ownership", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const importRequest = await stepRequest("step-import");
    const payload = { bytes: new Uint8Array([0x42, 0x52, 0x45, 0x50]) };
    const artifact = await defineArtifactRecord({
      kind: "brep", sourceRevision: importRequest.sourceRevision,
      producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: "a".repeat(64),
      contentDigest: await digestCadOutputPayload(payload), units: "m",
      mediaType: "application/vnd.opencascade.brep",
      dependencies: [{ kind: "artifact", artifactId: importRequest.step.artifact.id }],
    });
    const result = {
      requestId: importRequest.requestId, sourceRevision: importRequest.sourceRevision,
      sourceArtifactId: importRequest.step.artifact.id, artifact, payload, massProperties,
      envelopeM: { minimum: [0, 0, 0], maximum: [0.1, 0.04, 0.02] },
      solidCount: 1, invalidSolidCount: 0,
    } as const;

    const imported = client.importStep(importRequest, new AbortController().signal);
    await vi.waitFor(() => expect(worker.posted).toContainEqual({ type: "import-step", request: importRequest }));
    worker.emit({ type: "step-import-succeeded", requestId: importRequest.requestId, result });

    await expect(imported).resolves.toMatchObject(result);
  });
});
