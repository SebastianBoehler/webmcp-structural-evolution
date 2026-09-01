import { describe, expect, test } from "vitest";

import { createMechanismSolverClient, type MechanismSolverWorker } from "./mechanism-solver-client";
import { MechanismSolverRequestSchema } from "./mechanism-solver-protocol";
import { mechanismSolverInput } from "./mechanism-solver.test-support";

class FakeWorker implements MechanismSolverWorker {
  posted: { readonly message: unknown; readonly transfer: readonly Transferable[] }[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(event: unknown) => void>>();
  postMessage(message: unknown, transfer: readonly Transferable[] = []) { this.posted.push({ message, transfer }); }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const values = this.listeners.get(type) ?? new Set(); values.add(listener); this.listeners.set(type, values);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) { this.listeners.get(type)?.delete(listener); }
  terminate() { this.terminated = true; }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, values) => sum + values.size, 0); }
}

describe("mechanism solver worker client", () => {
  test("transfers owned bytes and cleans up on a schema-valid success", async () => {
    const worker = new FakeWorker();
    const input = await mechanismSolverInput();
    const promise = createMechanismSolverClient(() => worker)(input, new AbortController().signal);
    const posted = worker.posted[0]!;
    const request = MechanismSolverRequestSchema.parse(posted.message);
    expect(request.type).toBe("solve-mechanism");
    expect(posted.transfer).toEqual([request.type === "solve-mechanism" ? request.inputBytes.buffer : undefined]);
    const output = new TextEncoder().encode(JSON.stringify({ replay: {
      sourceRevision: input.sourceRevision, studyId: input.studyId, mechanismInputDigest: input.mechanismInputDigest,
      bodyIds: input.bodies.map(({ id }) => id), jointIds: [], colliderIds: input.colliders.map(({ id }) => id),
      clearancePairIds: [], frames: [], contacts: [], clearanceSamples: [],
    }, evidence: null }));
    worker.emit("message", { data: { type: "started", requestId: request.requestId,
      mechanismInputDigest: input.mechanismInputDigest } });
    worker.emit("message", { data: { type: "succeeded", requestId: request.requestId, outputBytes: output } });
    await expect(promise).resolves.toBeDefined();
    expect(worker.terminated).toBe(true);
    expect(worker.listenerCount()).toBe(0);
  });

  test("uses unique request IDs and settles cancellation, crash, messageerror, and synchronous delivery failure", async () => {
    const input = await mechanismSolverInput();
    const first = new FakeWorker(), second = new FakeWorker();
    const firstPromise = createMechanismSolverClient(() => first)(input, new AbortController().signal);
    const secondController = new AbortController();
    const secondPromise = createMechanismSolverClient(() => second)(input, secondController.signal);
    const firstRequest = MechanismSolverRequestSchema.parse(first.posted[0]!.message);
    const secondRequest = MechanismSolverRequestSchema.parse(second.posted[0]!.message);
    expect(firstRequest.requestId).not.toBe(secondRequest.requestId);
    secondController.abort();
    await expect(secondPromise).rejects.toMatchObject({ name: "AbortError" });
    expect((second.posted[1]!.message as { type: string }).type).toBe("cancel");
    expect(second.terminated).toBe(true); expect(second.listenerCount()).toBe(0);
    first.emit("error", { message: "rapier crashed" });
    await expect(firstPromise).rejects.toThrow("rapier crashed");
    expect(first.terminated).toBe(true); expect(first.listenerCount()).toBe(0);

    const malformed = new FakeWorker();
    const malformedPromise = createMechanismSolverClient(() => malformed)(input, new AbortController().signal);
    malformed.emit("messageerror", {});
    await expect(malformedPromise).rejects.toThrow("could not deserialize");
    expect(malformed.terminated).toBe(true); expect(malformed.listenerCount()).toBe(0);

    const synchronous = new (class extends FakeWorker {
      override postMessage() { throw new Error("post failed"); }
    })();
    await expect(createMechanismSolverClient(() => synchronous)(input, new AbortController().signal))
      .rejects.toThrow("post failed");
    expect(synchronous.terminated).toBe(true);
  });

  test("fails a mismatched terminal request and a synchronous worker factory crash", async () => {
    const input = await mechanismSolverInput();
    const worker = new FakeWorker();
    const promise = createMechanismSolverClient(() => worker)(input, new AbortController().signal);
    worker.emit("message", { data: { type: "cancelled", requestId: "different-request" } });
    await expect(promise).rejects.toThrow("invalid response");
    expect(worker.terminated).toBe(true); expect(worker.listenerCount()).toBe(0);
    await expect(createMechanismSolverClient(() => { throw new Error("factory crashed"); })(
      input, new AbortController().signal,
    )).rejects.toThrow("factory crashed");
  });

  test("fails closed on duplicate start acknowledgements", async () => {
    const input = await mechanismSolverInput(), worker = new FakeWorker();
    const promise = createMechanismSolverClient(() => worker)(input, new AbortController().signal);
    const request = MechanismSolverRequestSchema.parse(worker.posted[0]!.message);
    if (request.type !== "solve-mechanism") throw new Error("expected solve request");
    const started = { type: "started", requestId: request.requestId,
      mechanismInputDigest: input.mechanismInputDigest };

    worker.emit("message", { data: started });
    worker.emit("message", { data: started });

    await expect(promise).rejects.toThrow("invalid start acknowledgement");
    expect(worker.terminated).toBe(true); expect(worker.listenerCount()).toBe(0);
  });

  test("fails closed on a wrong start digest and a same-request terminal before start", async () => {
    const input = await mechanismSolverInput();
    const wrongDigest = new FakeWorker();
    const wrongPromise = createMechanismSolverClient(() => wrongDigest)(input, new AbortController().signal);
    const wrongRequest = MechanismSolverRequestSchema.parse(wrongDigest.posted[0]!.message);
    wrongDigest.emit("message", { data: { type: "started", requestId: wrongRequest.requestId,
      mechanismInputDigest: "f".repeat(64) } });
    await expect(wrongPromise).rejects.toThrow("invalid start acknowledgement");
    expect(wrongDigest.terminated).toBe(true); expect(wrongDigest.listenerCount()).toBe(0);

    const earlyTerminal = new FakeWorker();
    const earlyPromise = createMechanismSolverClient(() => earlyTerminal)(input, new AbortController().signal);
    const earlyRequest = MechanismSolverRequestSchema.parse(earlyTerminal.posted[0]!.message);
    earlyTerminal.emit("message", { data: { type: "failed", requestId: earlyRequest.requestId,
      error: "premature terminal" } });
    await expect(earlyPromise).rejects.toThrow("terminal before starting: premature terminal");
    expect(earlyTerminal.terminated).toBe(true); expect(earlyTerminal.listenerCount()).toBe(0);
  });

  test("terminates cleanly when the start callback throws", async () => {
    const input = await mechanismSolverInput(), worker = new FakeWorker();
    const promise = createMechanismSolverClient(() => worker)(input, new AbortController().signal, () => {
      throw new Error("callback failed");
    });
    const request = MechanismSolverRequestSchema.parse(worker.posted[0]!.message);
    worker.emit("message", { data: { type: "started", requestId: request.requestId,
      mechanismInputDigest: input.mechanismInputDigest } });

    await expect(promise).rejects.toThrow("callback failed");
    expect(worker.terminated).toBe(true); expect(worker.listenerCount()).toBe(0);
  });

  test("supports synchronous cancellation from the start callback", async () => {
    const input = await mechanismSolverInput(), worker = new FakeWorker();
    const controller = new AbortController();
    const promise = createMechanismSolverClient(() => worker)(input, controller.signal, () => controller.abort());
    const request = MechanismSolverRequestSchema.parse(worker.posted[0]!.message);

    worker.emit("message", { data: { type: "started", requestId: request.requestId,
      mechanismInputDigest: input.mechanismInputDigest } });

    expect(worker.posted.map(({ message }) => (message as { type: string }).type))
      .toEqual(["solve-mechanism", "cancel"]);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true); expect(worker.listenerCount()).toBe(0);
  });
});
