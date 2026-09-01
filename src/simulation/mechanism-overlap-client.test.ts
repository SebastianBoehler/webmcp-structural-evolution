import { describe, expect, it } from "vitest";

import { createMechanismOverlapClient, type MechanismOverlapWorker } from "./mechanism-overlap-client";

class ControlledWorker implements MechanismOverlapWorker {
  readonly posted: unknown[] = [];
  readonly transfers: readonly Transferable[][] = [];
  terminated = false;
  private messageListeners = new Set<(event: { readonly data: unknown }) => void>();
  private errorListeners = new Set<(event: { readonly message?: string }) => void>();
  private messageErrorListeners = new Set<(event: unknown) => void>();
  postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
    this.posted.push(message);
    (this.transfers as Transferable[][]).push([...transfer]);
  }
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void): void {
    if (type === "message") this.messageListeners.add(listener as (event: { readonly data: unknown }) => void);
    else if (type === "error") this.errorListeners.add(listener as (event: { readonly message?: string }) => void);
    else this.messageErrorListeners.add(listener);
  }
  removeEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void): void {
    if (type === "message") this.messageListeners.delete(listener as (event: { readonly data: unknown }) => void);
    else if (type === "error") this.errorListeners.delete(listener as (event: { readonly message?: string }) => void);
    else this.messageErrorListeners.delete(listener);
  }
  terminate(): void { this.terminated = true; }
  emit(data: unknown): void { for (const listener of this.messageListeners) listener({ data }); }
  emitError(message = "worker crashed"): void { for (const listener of this.errorListeners) listener({ message }); }
  emitMessageError(): void { for (const listener of this.messageErrorListeners) listener({}); }
  get listenerCount(): number {
    return this.messageListeners.size + this.errorListeners.size + this.messageErrorListeners.size;
  }
}

class ThrowingWorker extends ControlledWorker {
  constructor(private readonly throwAtPost: number) { super(); }
  override postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
    if (this.posted.length === this.throwAtPost) throw new DOMException("clone failed", "DataCloneError");
    super.postMessage(message, transfer);
  }
}

const sourceBodies = [{ bodyId: "body", brepBytes: new Uint8Array([1]) }];
const instances = [{
  instanceId: "first", membershipMask: 1, filterMask: 1,
  transform: { positionM: [0, 0, 0] as const, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const },
  bodyIds: ["body"],
}];

describe("mechanism overlap worker client", () => {
  it("accepts only a same-request worker success and terminates the worker", async () => {
    const worker = new ControlledWorker();
    const pending = createMechanismOverlapClient(() => worker)(sourceBodies, instances, new AbortController().signal);
    const request = worker.posted[0] as { requestId: string };
    worker.emit({ type: "succeeded", requestId: request.requestId });
    await expect(pending).resolves.toBeUndefined();
    expect(worker.terminated).toBe(true);
  });

  it("quarantines invalid responses and cancellation", async () => {
    const invalidWorker = new ControlledWorker();
    const invalid = createMechanismOverlapClient(() => invalidWorker)(sourceBodies, instances, new AbortController().signal);
    invalidWorker.emit({ type: "succeeded", requestId: "wrong" });
    await expect(invalid).rejects.toThrow(/invalid response/i);
    expect(invalidWorker.terminated).toBe(true);

    const cancelledWorker = new ControlledWorker();
    const controller = new AbortController();
    const cancelled = createMechanismOverlapClient(() => cancelledWorker)(sourceBodies, instances, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect((cancelledWorker.posted[1] as { type: string }).type).toBe("cancel");
    expect(cancelledWorker.terminated).toBe(true);
  });

  it("transfers one owned BREP buffer when multiple instances reuse one source body", async () => {
    const worker = new ControlledWorker();
    const reused = [...instances, { ...instances[0]!, instanceId: "second" }];
    const pending = createMechanismOverlapClient(() => worker)(sourceBodies, reused, new AbortController().signal);
    expect(worker.transfers[0]).toHaveLength(1);
    const request = worker.posted[0] as { requestId: string; sourceBodies: unknown[]; instances: unknown[] };
    expect(request.sourceBodies).toHaveLength(1);
    expect(request.instances).toHaveLength(2);
    worker.emit({ type: "succeeded", requestId: request.requestId });
    await expect(pending).resolves.toBeUndefined();
  });

  it("terminates and rejects when request or cancellation delivery throws", async () => {
    const requestWorker = new ThrowingWorker(0);
    await expect(createMechanismOverlapClient(() => requestWorker)(
      sourceBodies, instances, new AbortController().signal,
    )).rejects.toThrow(/clone failed/i);
    expect(requestWorker.terminated).toBe(true);

    const cancelWorker = new ThrowingWorker(1), controller = new AbortController();
    const pending = createMechanismOverlapClient(() => cancelWorker)(sourceBodies, instances, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelWorker.terminated).toBe(true);
  });

  it("does not miss cancellation while the worker factory is being created", async () => {
    const worker = new ControlledWorker(), controller = new AbortController();
    const pending = createMechanismOverlapClient(() => {
      controller.abort();
      return worker;
    })(sourceBodies, instances, controller.signal);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("settles worker module-load, crash, and message-deserialization failures", async () => {
    await expect(createMechanismOverlapClient(() => { throw new Error("module load failed"); })(
      sourceBodies, instances, new AbortController().signal,
    )).rejects.toThrow(/module load failed/i);

    const crashWorker = new ControlledWorker();
    const crashed = createMechanismOverlapClient(() => crashWorker)(sourceBodies, instances, new AbortController().signal);
    crashWorker.emitError();
    await expect(crashed).rejects.toThrow(/worker crashed/i);
    expect(crashWorker.terminated).toBe(true);
    expect(crashWorker.listenerCount).toBe(0);

    const messageErrorWorker = new ControlledWorker();
    const messageError = createMechanismOverlapClient(() => messageErrorWorker)(
      sourceBodies, instances, new AbortController().signal,
    );
    messageErrorWorker.emitMessageError();
    await expect(messageError).rejects.toThrow(/deserialize/i);
    expect(messageErrorWorker.terminated).toBe(true);
    expect(messageErrorWorker.listenerCount).toBe(0);
  });
});
