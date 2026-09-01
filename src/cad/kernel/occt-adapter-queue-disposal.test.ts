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
import { createOcctCadAdapter } from "./occt-adapter";
import type { OcctWorkerLike, OcctWorkerMessageEvent } from "./occt-worker-client";
import type { OcctWorkerRequest } from "./occt-worker-contract";

async function evaluationRequest(requestId: string): Promise<CadEvaluationRequest> {
  const document = await createDesignDocument({
    id: requestId, label: requestId, units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "human", id: "sebastian" },
  });
  return CadEvaluationRequestSchema.parse({
    requestId, document, sourceRevision: document.revision, requestedOutputs: ["mass-properties"], settings: {},
  });
}

async function stepRequest(requestId: string): Promise<ExactStepImportRequest> {
  const sourceRevision = "e".repeat(64);
  const payload = { bytes: new TextEncoder().encode("ISO-10303-21") };
  const artifact = await defineArtifactRecord({
    kind: "export", sourceRevision, producer: { name: "occt-wasm", version: "4.3.2" },
    settingsDigest: "a".repeat(64), contentDigest: await digestCadOutputPayload(payload),
    units: "mm", mediaType: "model/step", dependencies: [],
  });
  return ExactStepImportRequestSchema.parseAsync({
    requestId, sourceRevision, step: { artifact, payload }, settings: {},
  });
}

class QueueWorker implements OcctWorkerLike {
  readonly posted: OcctWorkerRequest[] = [];
  terminateCount = 0;
  private readonly listeners = new Set<(event: OcctWorkerMessageEvent) => void>();

  postMessage(message: unknown): void { this.posted.push(message as OcctWorkerRequest); }
  addEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void { this.listeners.delete(listener); }
  terminate(): void { this.terminateCount += 1; }
  listenerCount(): number { return this.listeners.size; }
}

describe("OCCT adapter queue disposal", () => {
  it("closes the mixed client queue before active abort can start replacement workers", async () => {
    const workers = [new QueueWorker(), new QueueWorker(), new QueueWorker(), new QueueWorker(), new QueueWorker()];
    let factoryCalls = 0;
    const adapter = createOcctCadAdapter(() => workers[factoryCalls++]!);
    const activeEvents: CadEvaluationEvent[] = [];
    const active = adapter.evaluate(
      await evaluationRequest("active"), new AbortController().signal, (event) => activeEvents.push(event),
    );
    await vi.waitFor(() => expect(workers[0].posted).toContainEqual(expect.objectContaining({ type: "evaluate" })));

    const queuedEvents = [[], []] as CadEvaluationEvent[][];
    const queued = [
      adapter.importStep(await stepRequest("queued-step-a"), new AbortController().signal),
      adapter.evaluate(await evaluationRequest("queued-evaluation-a"), new AbortController().signal, (event) => queuedEvents[0].push(event)),
      adapter.importStep(await stepRequest("queued-step-b"), new AbortController().signal),
      adapter.evaluate(await evaluationRequest("queued-evaluation-b"), new AbortController().signal, (event) => queuedEvents[1].push(event)),
    ];
    await vi.waitFor(() => expect(workers[0].posted).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    adapter.dispose?.();
    adapter.dispose?.();

    await active;
    await expect(queued[0]).rejects.toMatchObject({ name: "AbortError" });
    await queued[1];
    await expect(queued[2]).rejects.toMatchObject({ name: "AbortError" });
    await queued[3];

    expect(workers.flatMap((worker) => worker.posted).filter((message) =>
      message.type === "evaluate" || message.type === "import-step")).toEqual([
      expect.objectContaining({ type: "evaluate", request: expect.objectContaining({ requestId: "active" }) }),
    ]);
    expect(factoryCalls).toBe(1);
    expect(activeEvents).toEqual([expect.objectContaining({ state: "cancelled", workerDisposition: "quarantined" })]);
    expect(queuedEvents).toEqual([
      [expect.objectContaining({ state: "cancelled", workerDisposition: "not-started" })],
      [expect.objectContaining({ state: "cancelled", workerDisposition: "not-started" })],
    ]);
    expect(workers[0].terminateCount).toBe(1);
    expect(workers.every((worker) => worker.listenerCount() === 0)).toBe(true);
  });
});
