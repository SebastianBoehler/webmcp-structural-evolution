import { beforeAll, describe, expect, test, vi } from "vitest";

import type { MechanismInput } from "./mechanism-contract";
import { createMechanismSolverWorkerRuntime } from "./mechanism-solver-worker-runtime";
import { createMechanismSolverClient, type MechanismSolverWorker } from "./mechanism-solver-client";
import { MechanismWorkerOutputSchema } from "./mechanism-solver-output";
import { mechanismSolverInput } from "./mechanism-solver.test-support";

class Scope {
  messages: { readonly value: unknown; readonly transfer: readonly Transferable[] }[] = [];
  listener?: (event: { readonly data: unknown }) => void;
  postMessage(value: unknown, transfer: readonly Transferable[] = []) { this.messages.push({ value, transfer }); }
  addEventListener(_type: "message", listener: (event: { readonly data: unknown }) => void) { this.listener = listener; }
  send(data: unknown) { this.listener!({ data }); }
}

class RuntimeWorker implements MechanismSolverWorker {
  readonly requests: unknown[] = [];
  readonly events: unknown[] = [];
  terminated = false;
  private runtimeListener?: (event: { readonly data: unknown }) => void;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(
    solve: Parameters<typeof createMechanismSolverWorkerRuntime>[1],
    private readonly synchronous = false,
  ) {
    createMechanismSolverWorkerRuntime({
      postMessage: (value) => {
        this.events.push(value);
        if (this.synchronous) this.emit("message", { data: value });
        else queueMicrotask(() => this.emit("message", { data: value }));
      },
      addEventListener: (_type, listener) => { this.runtimeListener = listener; },
    }, solve);
  }

  postMessage(message: unknown) { this.requests.push(message); this.runtimeListener!({ data: message }); }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const values = this.listeners.get(type) ?? new Set(); values.add(listener); this.listeners.set(type, values);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) { this.listeners.get(type)?.delete(listener); }
  terminate() { this.terminated = true; this.listeners.clear(); }
  private emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}
const digest = (value: string) => value.repeat(64);
let validInput: MechanismInput;
beforeAll(async () => { validInput = await mechanismSolverInput(); });
const solveRequest = (requestId: string, input: MechanismInput = validInput) => ({
  type: "solve-mechanism", requestId, mechanismInputDigest: input.mechanismInputDigest,
  inputBytes: new TextEncoder().encode(JSON.stringify(input)),
});
const output = MechanismWorkerOutputSchema.parse({
  replay: { sourceRevision: digest("a"), studyId: "study", mechanismInputDigest: digest("b"),
    bodyIds: ["body"], jointIds: [], colliderIds: ["collider"], clearancePairIds: [],
    frames: [{ sourceRevision: digest("a"), studyId: "study", mechanismInputDigest: digest("b"), stepIndex: 0,
      bodies: [{ bodyId: "body", positionM: [0, 0, 0], orientation: [0, 0, 0, 1],
        linearVelocityMps: [0, 0, 0], angularVelocityRadS: [0, 0, 0] }], joints: [] }],
    contacts: [], clearanceSamples: [] },
  evidence: { mechanismInputDigest: digest("b"), engineVersion: "0.18.1", runtimeVersion: "deterministic",
    runtimeDigest: digest("c"), solverBuildDigest: digest("d"), wasmModuleDigest: digest("e"),
    workerArtifactDigest: digest("6"), settingsDigest: digest("f"),
    verification: { initialLinearMomentumKgMps: [0, 0, 0], finalLinearMomentumKgMps: [0, 0, 0],
      initialAngularMomentumKgM2ps: [0, 0, 0], finalAngularMomentumKgM2ps: [0, 0, 0], energyChangeJ: 0,
      gravityWorkJ: 0, pointForceWorkJ: 0, energyAccountingErrorJ: 0, maximumJointErrorM: 0 } },
});

describe("mechanism solver worker runtime", () => {
  test("rejects forged self-consistent digest claims before started", async () => {
    const scope = new Scope(), solve = vi.fn();
    const valid = await mechanismSolverInput();
    const forged = { ...valid, durationSteps: 6 };
    createMechanismSolverWorkerRuntime(scope, solve);

    scope.send({ type: "solve-mechanism", requestId: "forged",
      mechanismInputDigest: valid.mechanismInputDigest,
      inputBytes: new TextEncoder().encode(JSON.stringify(forged)) });

    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));
    expect(scope.messages[0]!.value).toMatchObject({ type: "failed", requestId: "forged",
      error: expect.stringMatching(/digest/i) });
    expect(scope.messages.some(({ value }) => (value as { type?: string }).type === "started")).toBe(false);
    expect(solve).not.toHaveBeenCalled();
  });

  test("acknowledges a digest-bound request after establishing it as active", async () => {
    const scope = new Scope();
    let finish!: (value: typeof output) => void;
    const solve = vi.fn(async () => new Promise<typeof output>((resolve) => { finish = resolve; }));
    createMechanismSolverWorkerRuntime(scope, solve);
    const input = validInput;

    scope.send({ type: "solve-mechanism", requestId: "started",
      mechanismInputDigest: input.mechanismInputDigest,
      inputBytes: new TextEncoder().encode(JSON.stringify(input)) });

    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));
    expect(scope.messages).toEqual([{ value: {
      type: "started", requestId: "started", mechanismInputDigest: input.mechanismInputDigest,
    }, transfer: [] }]);
    expect(solve).toHaveBeenCalledWith(input, expect.any(AbortSignal));
    finish(output);
    await vi.waitFor(() => expect(scope.messages).toHaveLength(2));
  });

  test("delivers cancellation to an active solve exactly once", async () => {
    const scope = new Scope();
    createMechanismSolverWorkerRuntime(scope, async (_value, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    scope.send(solveRequest("request"));
    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));
    scope.send({ type: "cancel", requestId: "request" });
    await vi.waitFor(() => expect(scope.messages).toHaveLength(2));
    expect(scope.messages[1]!.value).toEqual({ type: "cancelled", requestId: "request" });
  });

  test("does not invoke solve when started delivery synchronously cancels", async () => {
    const solve = vi.fn(async () => output);
    const scope = new (class extends Scope {
      override postMessage(value: unknown, transfer: readonly Transferable[] = []) {
        super.postMessage(value, transfer);
        if ((value as { type?: string }).type === "started") {
          this.send({ type: "cancel", requestId: (value as { requestId: string }).requestId });
        }
      }
    })();
    createMechanismSolverWorkerRuntime(scope, solve);

    scope.send(solveRequest("reentrant-cancel"));

    await vi.waitFor(() => expect(scope.messages).toHaveLength(2));
    expect(scope.messages.map(({ value }) => (value as { type: string }).type)).toEqual(["started", "cancelled"]);
    expect(solve).not.toHaveBeenCalled();
  });

  test("client cancellation is safe through a synchronously reentrant real runtime", async () => {
    const solve = vi.fn(async () => output);
    const worker = new RuntimeWorker(solve, true);
    const controller = new AbortController();
    const client = createMechanismSolverClient(() => worker);

    const promise = client(validInput, controller.signal, () => controller.abort());

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(worker.events.map((event) =>
      (event as { type: string }).type)).toEqual(["started", "cancelled"]));
    expect(worker.requests.map((request) => (request as { type: string }).type))
      .toEqual(["solve-mechanism", "cancel"]);
    expect(solve).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
  });

  test("validates and transfers a bounded success payload", async () => {
    const scope = new Scope();
    createMechanismSolverWorkerRuntime(scope, async () => output);
    scope.send(solveRequest("success"));
    await vi.waitFor(() => expect(scope.messages).toHaveLength(2));
    const event = scope.messages[1]!.value as { type: string; outputBytes: Uint8Array };
    expect(event.type).toBe("succeeded");
    expect(JSON.parse(new TextDecoder().decode(event.outputBytes))).toEqual(output);
    expect(scope.messages[1]!.transfer).toEqual([event.outputBytes.buffer]);
  });

  test("fails malformed ingress without invoking the solver", async () => {
    const scope = new Scope(), solve = vi.fn();
    createMechanismSolverWorkerRuntime(scope, solve);
    scope.send({ type: "solve-mechanism", requestId: "bad", inputBytes: new Uint8Array() });
    expect(scope.messages[0]!.value).toEqual({ type: "failed", requestId: "bad",
      error: "Mechanism solver received an invalid request" });
    expect(solve).not.toHaveBeenCalled();
  });

  test("rejects concurrent work without disturbing the active request", async () => {
    const scope = new Scope();
    let finish!: (value: typeof output) => void;
    createMechanismSolverWorkerRuntime(scope, async () => new Promise((resolve) => { finish = resolve; }));
    scope.send(solveRequest("first"));
    scope.send(solveRequest("second"));
    expect(scope.messages[0]!.value).toEqual({ type: "failed", requestId: "second",
      error: "Mechanism solver worker is already active" });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(output);
    await vi.waitFor(() => expect(scope.messages).toHaveLength(3));
    expect((scope.messages[2]!.value as { requestId: string }).requestId).toBe("first");
  });

  test("checks cancellation after an uncooperative solve await and emits one terminal", async () => {
    const scope = new Scope();
    let finish!: (value: typeof output) => void;
    createMechanismSolverWorkerRuntime(scope, async () => new Promise((resolve) => { finish = resolve; }));
    scope.send(solveRequest("late"));
    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));
    scope.send({ type: "cancel", requestId: "late" });
    finish(output);
    await vi.waitFor(() => expect(scope.messages).toHaveLength(2));
    expect(scope.messages[1]!.value).toEqual({ type: "cancelled", requestId: "late" });
  });

  test("reports invalid JSON as a bounded failure", async () => {
    const scope = new Scope();
    createMechanismSolverWorkerRuntime(scope, async () => ({}) as never);
    scope.send({ type: "solve-mechanism", requestId: "failure",
      mechanismInputDigest: validInput.mechanismInputDigest, inputBytes: new TextEncoder().encode("{") });
    await vi.waitFor(() => expect(scope.messages.at(-1)!.value).toMatchObject({
      type: "failed", requestId: "failure", error: expect.stringContaining("JSON"),
    }));
  });

  test("reports invalid solver output as a bounded failure", async () => {
    const scope = new Scope();
    createMechanismSolverWorkerRuntime(scope, async () => ({}) as never);
    scope.send(solveRequest("failure"));
    await vi.waitFor(() => expect(scope.messages.at(-1)!.value).toMatchObject({
      type: "failed", requestId: "failure", error: expect.stringContaining("expected object"),
    }));
  });

  test("propagates authoritative start before cancellation and recovers with a fresh runtime", async () => {
    const first = new RuntimeWorker(async (_value, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const second = new RuntimeWorker(async () => output);
    const workers = [first, second];
    const client = createMechanismSolverClient(() => workers.shift()!);
    const input = await mechanismSolverInput();
    const controller = new AbortController();
    const starts: unknown[] = [];

    const cancelled = client(input, controller.signal, (started) => {
      starts.push(started);
      controller.abort();
    });

    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(first.events.filter((event) =>
      (event as { type?: string }).type === "cancelled")).toHaveLength(1));
    expect(starts).toEqual([{ type: "started", requestId: expect.any(String),
      mechanismInputDigest: input.mechanismInputDigest }]);
    expect(first.requests.map((request) => (request as { type: string }).type)).toEqual(["solve-mechanism", "cancel"]);
    expect(first.terminated).toBe(true);

    await expect(client(input, new AbortController().signal, () => undefined)).resolves.toEqual(output);
    expect(second.terminated).toBe(true);
  });
});
