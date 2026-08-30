import { describe, expect, it, vi } from "vitest";

import { defineArtifactRecord } from "../artifact-contract";
import { createDesignDocument } from "../document-schema";
import { digestCadOutputPayload } from "../rebuild-payload";
import {
  CadEvaluationRequestSchema,
  type CadEvaluationEvent,
  type CadEvaluationRequest,
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

async function request(requestId: string): Promise<CadEvaluationRequest> {
  const document = await createDesignDocument({
    id: "part",
    label: "Part",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "agent", id: "test" },
  });
  return CadEvaluationRequestSchema.parse({
    requestId,
    document,
    sourceRevision: document.revision,
    requestedOutputs: ["mass-properties"],
    settings: {},
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

  it("fails the active request and replaces the worker after a protocol mismatch", async () => {
    const workers = [new ControlledWorker(), new ControlledWorker()];
    let factoryCalls = 0;
    const client = createOcctWorkerClient(() => workers[factoryCalls++]!);
    const events: CadEvaluationEvent[] = [];
    const first = client.evaluate(await request("first"), new AbortController().signal, (event) => events.push(event));

    workers[0]!.emit({ type: "progress", requestId: "someone-else", progress: 0.5 });
    await first;
    const second = client.evaluate(await request("second"), new AbortController().signal, (event) => events.push(event));

    expect(events[0]).toMatchObject({
      requestId: "first",
      state: "failed",
      error: { code: "internal-error" },
    });
    expect(workers[0]!.terminateCount).toBe(1);
    expect(factoryCalls).toBe(2);
    workers[1]!.emit({ type: "cancelled", requestId: "second" });
    await second;
  });

  it("rejects malformed worker messages as protocol failures", async () => {
    const worker = new ControlledWorker();
    const client = createOcctWorkerClient(() => worker);
    const events: CadEvaluationEvent[] = [];
    const evaluation = client.evaluate(await request("malformed"), new AbortController().signal, (event) => events.push(event));

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

    worker.emit({
      type: "succeeded",
      requestId: "wrong-outputs",
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

    worker.emit({
      type: "succeeded",
      requestId: "first",
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
    expect(worker.posted.filter((message) => message.type === "evaluate").map((message) => message.request.requestId))
      .toEqual(["first", "second"]);
    worker.emit({
      type: "succeeded",
      requestId: "second",
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

    worker.emit({
      type: "succeeded",
      requestId: "brep",
      requestedOutputs: ["brep"],
      results: [{ output: "brep", artifact, payload }],
    });
    await evaluation;

    expect(events).toEqual([{
      requestId: "brep",
      state: "succeeded",
      requestedOutputs: ["brep"],
      results: [{ output: "brep", artifact, payload }],
    }]);
  });
});
