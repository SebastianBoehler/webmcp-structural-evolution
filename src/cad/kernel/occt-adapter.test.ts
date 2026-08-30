import { describe, expect, it } from "vitest";

import { createDesignDocument } from "../document-schema";
import {
  CadEvaluationRequestSchema,
  type CadEvaluationEvent,
  type CadEvaluationRequest,
} from "../runtime-contracts";
import { createOcctCadAdapter } from "./occt-adapter";
import type { OcctWorkerLike, OcctWorkerMessageEvent } from "./occt-worker-client";
import type { OcctWorkerRequest } from "./occt-worker-contract";

const massProperties = {
  densityKgM3: 1, volumeM3: 1, surfaceAreaM2: 1, massKg: 1,
  centerOfMassM: [0, 0, 0], inertiaKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

async function request(requestId: string): Promise<CadEvaluationRequest> {
  const document = await createDesignDocument({
    id: "pump",
    label: "Pump",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "human", id: "sebastian" },
  });
  return CadEvaluationRequestSchema.parse({
    requestId,
    document,
    sourceRevision: document.revision,
    requestedOutputs: ["mass-properties"],
    settings: {},
  });
}

class LifecycleWorker implements OcctWorkerLike {
  readonly posted: OcctWorkerRequest[] = [];
  terminateCount = 0;
  private readonly listeners = new Set<(event: OcctWorkerMessageEvent) => void>();

  constructor(private readonly acknowledgeCancellation = true) {}

  postMessage(message: unknown): void {
    const request = message as OcctWorkerRequest;
    this.posted.push(request);
    if (request.type === "evaluate") {
      this.emit({ type: "progress", requestId: request.request.requestId, progress: 0 });
      return;
    }
    if (request.type === "cancel" && this.acknowledgeCancellation) {
      this.emit({ type: "cancelled", requestId: request.requestId });
    }
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

  succeed(requestId: string): void {
    this.emit({
      type: "succeeded",
      requestId,
      requestedOutputs: ["mass-properties"],
      results: [{ output: "mass-properties", payload: massProperties }],
    });
  }

  private emit(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }
}

describe("OCCT CAD adapter", () => {
  it("quarantines a cancelled worker and runs the next rebuild on a fresh worker", async () => {
    const workers = [new LifecycleWorker(), new LifecycleWorker()];
    let factoryCalls = 0;
    const adapter = createOcctCadAdapter(() => workers[factoryCalls++]!);
    const events: CadEvaluationEvent[] = [];
    const controller = new AbortController();
    const first = adapter.evaluate(await request("first"), controller.signal, (event) => events.push(event));

    controller.abort();
    await first;
    const second = adapter.evaluate(await request("second"), new AbortController().signal, (event) => events.push(event));
    workers[1]!.succeed("second");
    await second;

    const statesFor = (requestId: string) => events
      .filter((event) => event.requestId === requestId)
      .map((event) => event.state);
    expect(statesFor("first")).toEqual(["progress", "cancelled"]);
    expect(statesFor("second")).toEqual(["progress", "succeeded"]);
    expect(events.find((event) => event.requestId === "first" && event.state === "cancelled"))
      .toMatchObject({ workerDisposition: "quarantined" });
    expect(workers[0]!.terminateCount).toBe(1);
    expect(workers[1]!.terminateCount).toBe(0);
    expect(factoryCalls).toBe(2);
  });

  it("serializes access to the shared OCCT worker", async () => {
    const worker = new LifecycleWorker();
    const adapter = createOcctCadAdapter(() => worker);
    const first = adapter.evaluate(await request("first"), new AbortController().signal, () => undefined);
    const second = adapter.evaluate(await request("second"), new AbortController().signal, () => undefined);

    expect(worker.posted.filter((message) => message.type === "evaluate")).toHaveLength(1);
    worker.succeed("first");
    await first;
    expect(worker.posted.filter((message) => message.type === "evaluate")).toHaveLength(2);
    worker.succeed("second");
    await second;
  });

  it("never publishes a success after cancellation wins the race", async () => {
    const worker = new LifecycleWorker(false);
    const adapter = createOcctCadAdapter(() => worker);
    const events: CadEvaluationEvent[] = [];
    const controller = new AbortController();
    const evaluation = adapter.evaluate(
      await request("race"),
      controller.signal,
      (event) => events.push(event),
    );

    controller.abort();
    worker.succeed("race");
    await evaluation;

    expect(events).toEqual([
      { requestId: "race", state: "progress", progress: 0 },
      { requestId: "race", state: "cancelled", workerDisposition: "quarantined" },
    ]);
    expect(worker.terminateCount).toBe(1);
  });
});
