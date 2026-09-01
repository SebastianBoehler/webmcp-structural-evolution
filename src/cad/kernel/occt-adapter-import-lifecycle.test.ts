import { describe, expect, it, vi } from "vitest";

import { defineArtifactRecord } from "../artifact-contract";
import { digestCadOutputPayload } from "../rebuild-payload";
import { ExactStepImportRequestSchema, type ExactStepImportRequest } from "../runtime-contracts";
import { createOcctCadAdapter } from "./occt-adapter";
import type { OcctWorkerLike, OcctWorkerMessageEvent } from "./occt-worker-client";

class StepWorker implements OcctWorkerLike {
  readonly posted: unknown[] = [];
  terminateCount = 0;
  private readonly listeners = new Set<(event: OcctWorkerMessageEvent) => void>();

  postMessage(message: unknown): void {
    this.posted.push(message);
    const request = message as { type?: string; requestId?: string };
    if (request.type === "cancel" && request.requestId) this.emit({ type: "cancelled", requestId: request.requestId });
  }
  addEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void { this.listeners.delete(listener); }
  terminate(): void { this.terminateCount += 1; }
  listenerCount(): number { return this.listeners.size; }
  private emit(data: unknown): void { for (const listener of this.listeners) listener({ data }); }
}

async function stepRequest(): Promise<ExactStepImportRequest> {
  const sourceRevision = "e".repeat(64);
  const payload = { bytes: new TextEncoder().encode("ISO-10303-21") };
  const artifact = await defineArtifactRecord({
    kind: "export", sourceRevision, producer: { name: "occt-wasm", version: "4.3.2" },
    settingsDigest: "a".repeat(64), contentDigest: await digestCadOutputPayload(payload),
    units: "mm", mediaType: "model/step", dependencies: [],
  });
  return ExactStepImportRequestSchema.parseAsync({
    requestId: "dispose-step", sourceRevision, step: { artifact, payload }, settings: {},
  });
}

describe("OCCT adapter STEP import lifecycle", () => {
  it("rejects use-after-dispose before creating a worker", async () => {
    const worker = new StepWorker();
    const adapter = createOcctCadAdapter(() => worker);
    adapter.dispose?.();

    await expect(adapter.importStep({} as ExactStepImportRequest, new AbortController().signal))
      .rejects.toThrow(/disposed/i);

    expect(worker.posted).toEqual([]);
    expect(worker.terminateCount).toBe(0);
  });

  it("rejects a pending STEP import when the adapter is disposed", async () => {
    const worker = new StepWorker();
    const adapter = createOcctCadAdapter(() => worker);
    const pending = adapter.importStep(await stepRequest(), new AbortController().signal);

    await vi.waitFor(() => expect(worker.posted).toContainEqual(expect.objectContaining({ type: "import-step" })));
    adapter.dispose?.();
    adapter.dispose?.();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminateCount).toBe(1);
    expect(worker.listenerCount()).toBe(0);
  });
});
