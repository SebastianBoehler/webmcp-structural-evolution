import { describe, expect, it, vi } from "vitest";

import { defineArtifactRecord } from "../artifact-contract";
import { CAD_RESOURCE_LIMITS } from "../cad-resource-limits";
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

function delayNextDigest(matching: (text: string) => boolean) {
  const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let release: () => void = () => undefined;
  let started = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let signalStarted: () => void = () => undefined;
  const startedPromise = new Promise<void>((resolve) => { signalStarted = resolve; });
  const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    if (!started && matching(new TextDecoder().decode(bytes))) {
      started = true;
      signalStarted();
      await gate;
    }
    return originalDigest(algorithm, data);
  });
  return { release, spy, started: startedPromise };
}

function overBudgetSemanticMeshPayload() {
  const record = {
    id: "face-1", bodyId: "body-1",
    signature: {
      ownerFeatureId: "base", kind: "face", geometry: "plane",
      centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [],
    },
  };
  let recordReads = 0;
  const faces = new Proxy(
    Array.from({ length: CAD_RESOURCE_LIMITS.semanticMeshTopologyRecords + 1 }, () => record),
    {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) recordReads += 1;
        return Reflect.get(target, property, receiver);
      },
    },
  );
  return {
    payload: {
      positionsM: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(),
      faces, triangleFaceIndices: new Uint32Array(), edgePointsM: new Float32Array(),
      edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
    },
    recordReads: () => recordReads,
  };
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

  it("preserves submission order while document verification settles", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const firstRequest = await request("first-ingress");
    const secondRequest = await request("second-ingress");
    const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    let digestCalls = 0;
    let releaseFirstDigest: () => void = () => undefined;
    const firstDigestGate = new Promise<void>((resolve) => { releaseFirstDigest = resolve; });
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
      digestCalls += 1;
      if (digestCalls === 1) await firstDigestGate;
      return originalDigest(algorithm, data);
    });

    const first = client.evaluate(firstRequest, new AbortController().signal, () => undefined);
    const second = client.evaluate(secondRequest, new AbortController().signal, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirstDigest();

    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    const postedIds = () => worker.posted.flatMap((message) =>
      message.type === "evaluate" ? [message.request.requestId] : []);
    const complete = (requestId: string) => worker.emit({
      type: "succeeded", requestId, sourceRevision: revisionFor(requestId),
      requestedOutputs: ["mass-properties"],
      results: [{ output: "mass-properties", payload: massProperties }],
    });
    complete(postedIds()[0]!);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
    complete(postedIds()[1]!);
    await Promise.all([first, second]);

    expect(postedIds()).toEqual(["first-ingress", "second-ingress"]);
  });

  it("does not let a later STEP import overtake a delayed evaluation ingress", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const evaluationRequest = await request("evaluate-first");
    const importRequest = await stepRequest("import-second");
    const delay = delayNextDigest((text) => text.includes('"schemaVersion":2'));
    try {
      const evaluation = client.evaluate(evaluationRequest, new AbortController().signal, () => undefined);
      const imported = client.importStep(importRequest, new AbortController().signal);

      await delay.started;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(worker.posted).toEqual([]);
      delay.release();

      await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
      expect(worker.posted[0]).toMatchObject({ type: "evaluate", request: { requestId: "evaluate-first" } });
      worker.emit({ type: "failed", requestId: "evaluate-first", error: { code: "feature-failed", message: "stop" } });
      await evaluation;
      await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
      expect(worker.posted[1]).toMatchObject({ type: "import-step", request: { requestId: "import-second" } });
      worker.emit({ type: "failed", requestId: "import-second", error: { code: "feature-failed", message: "stop" } });
      await expect(imported).rejects.toThrow(/feature-failed/i);
    } finally {
      delay.spy.mockRestore();
    }
  });

  it("does not let a later evaluation overtake a delayed STEP-import ingress", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const importRequest = await stepRequest("import-first");
    const evaluationRequest = await request("evaluate-second");
    const delay = delayNextDigest((text) => text.includes('"contentDigest"'));
    try {
      const imported = client.importStep(importRequest, new AbortController().signal);
      const evaluation = client.evaluate(evaluationRequest, new AbortController().signal, () => undefined);

      await delay.started;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(worker.posted).toEqual([]);
      delay.release();

      await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
      expect(worker.posted[0]).toMatchObject({ type: "import-step", request: { requestId: "import-first" } });
      worker.emit({ type: "failed", requestId: "import-first", error: { code: "feature-failed", message: "stop" } });
      await expect(imported).rejects.toThrow(/feature-failed/i);
      await vi.waitFor(() => expect(worker.posted).toHaveLength(2));
      expect(worker.posted[1]).toMatchObject({ type: "evaluate", request: { requestId: "evaluate-second" } });
      worker.emit({ type: "failed", requestId: "evaluate-second", error: { code: "feature-failed", message: "stop" } });
      await evaluation;
    } finally {
      delay.spy.mockRestore();
    }
  });

  it("makes a delayed invalid STEP import consume its ingress turn before a later evaluation", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const importRequest = await stepRequest("invalid-import-first");
    const invalid = {
      ...importRequest,
      step: {
        ...importRequest.step,
        payload: { bytes: new TextEncoder().encode("tampered STEP bytes") },
      },
    } as ExactStepImportRequest;
    const evaluationRequest = await request("evaluate-after-invalid");
    const events: CadEvaluationEvent[] = [];
    const delay = delayNextDigest((text) => text.includes('"contentDigest"'));
    try {
      const imported = client.importStep(invalid, new AbortController().signal);
      const evaluation = client.evaluate(
        evaluationRequest, new AbortController().signal, (event) => events.push(event),
      );

      await delay.started;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(worker.posted).toEqual([]);
      delay.release();
      await expect(imported).rejects.toThrow(/content digest/i);
      await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
      expect(worker.posted[0]).toMatchObject({ type: "evaluate", request: { requestId: "evaluate-after-invalid" } });
      worker.emit({ type: "failed", requestId: "evaluate-after-invalid", error: { code: "feature-failed", message: "stop" } });
      await evaluation;
      expect(events).toMatchObject([{
        requestId: "evaluate-after-invalid", state: "failed", error: { code: "feature-failed" },
      }]);
    } finally {
      delay.spy.mockRestore();
    }
  });

  it.each([
    ["missing", undefined],
    ["non-string", 42],
  ] as const)("quarantines a %s success envelope before its oversized payload is attributed", async (_kind, requestId) => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const evaluation = client.evaluate(
      await request("unowned-success"), new AbortController().signal, (event) => events.push(event),
    );
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    const oversized = overBudgetSemanticMeshPayload();
    const message: Record<string, unknown> = {
      type: "succeeded", sourceRevision: revisionFor("unowned-success"),
      requestedOutputs: ["semantic-mesh"],
      results: [{ output: "semantic-mesh", payload: oversized.payload }],
    };
    if (requestId !== undefined) message.requestId = requestId;
    worker.emit(message);
    await evaluation;

    expect(events).toMatchObject([{
      requestId: "unowned-success", state: "failed", error: { code: "internal-error" },
    }]);
    expect(oversized.recordReads()).toBe(0);
    expect(worker.terminateCount).toBe(1);
    expect(worker.listenerCount).toBe(0);
  });

  it("maps a correctly owner-bound over-budget semantic payload to resource-limit before record traversal", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const evaluation = client.evaluate(
      await request("resource-limit"), new AbortController().signal, (event) => events.push(event),
    );
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    const oversized = overBudgetSemanticMeshPayload();
    worker.emit({
      type: "succeeded", requestId: "resource-limit", sourceRevision: revisionFor("resource-limit"),
      requestedOutputs: ["semantic-mesh"],
      results: [{
        output: "semantic-mesh",
        payload: oversized.payload,
      }],
    });
    await evaluation;

    expect(events).toMatchObject([{
      requestId: "resource-limit", state: "failed", error: { code: "resource-limit" },
    }]);
    expect(oversized.recordReads()).toBe(0);
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

  it("does not let a later oversized same-ID success steal a settling valid terminal", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const originalParse = OcctWorkerEventSchema.safeParseAsync.bind(OcctWorkerEventSchema);
    let releaseValidation: () => void = () => undefined;
    let markValidationStarted: () => void = () => undefined;
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
    const validationStarted = new Promise<void>((resolve) => { markValidationStarted = resolve; });
    const parse = vi.spyOn(OcctWorkerEventSchema, "safeParseAsync").mockImplementationOnce(async (value) => {
      markValidationStarted();
      await validationGate;
      return originalParse(value);
    });
    try {
      const evaluation = client.evaluate(
        await request("first-success-wins"), new AbortController().signal, (event) => events.push(event),
      );
      await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
      worker.emit({
        type: "succeeded", requestId: "first-success-wins", sourceRevision: revisionFor("first-success-wins"),
        requestedOutputs: ["mass-properties"],
        results: [{ output: "mass-properties", payload: massProperties }],
      });
      await validationStarted;
      const oversized = overBudgetSemanticMeshPayload();
      worker.emit({
        type: "succeeded", requestId: "first-success-wins", sourceRevision: revisionFor("first-success-wins"),
        requestedOutputs: ["semantic-mesh"],
        results: [{ output: "semantic-mesh", payload: oversized.payload }],
      });
      releaseValidation();
      await evaluation;

      expect(events.map(({ state }) => state)).toEqual(["succeeded"]);
      expect(oversized.recordReads()).toBe(0);
      expect(worker.terminateCount).toBe(0);
    } finally {
      releaseValidation();
      parse.mockRestore();
    }
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
