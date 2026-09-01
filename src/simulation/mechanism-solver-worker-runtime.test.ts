import { describe, expect, test, vi } from "vitest";

import { createMechanismSolverWorkerRuntime } from "./mechanism-solver-worker-runtime";
import { MechanismWorkerOutputSchema } from "./mechanism-solver-output";

class Scope {
  messages: { readonly value: unknown; readonly transfer: readonly Transferable[] }[] = [];
  listener?: (event: { readonly data: unknown }) => void;
  postMessage(value: unknown, transfer: readonly Transferable[] = []) { this.messages.push({ value, transfer }); }
  addEventListener(_type: "message", listener: (event: { readonly data: unknown }) => void) { this.listener = listener; }
  send(data: unknown) { this.listener!({ data }); }
}
const digest = (value: string) => value.repeat(64);
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
  test("delivers cancellation to an active solve exactly once", async () => {
    const scope = new Scope();
    createMechanismSolverWorkerRuntime(scope, async (_value, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    scope.send({ type: "solve-mechanism", requestId: "request", inputBytes: new TextEncoder().encode("{}") });
    scope.send({ type: "cancel", requestId: "request" });
    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));
    expect(scope.messages[0]!.value).toEqual({ type: "cancelled", requestId: "request" });
  });

  test("validates and transfers a bounded success payload", async () => {
    const scope = new Scope();
    createMechanismSolverWorkerRuntime(scope, async () => output);
    scope.send({ type: "solve-mechanism", requestId: "success", inputBytes: new TextEncoder().encode("{}") });
    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));
    const event = scope.messages[0]!.value as { type: string; outputBytes: Uint8Array };
    expect(event.type).toBe("succeeded");
    expect(JSON.parse(new TextDecoder().decode(event.outputBytes))).toEqual(output);
    expect(scope.messages[0]!.transfer).toEqual([event.outputBytes.buffer]);
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
    const bytes = new TextEncoder().encode("{}");
    scope.send({ type: "solve-mechanism", requestId: "first", inputBytes: bytes });
    scope.send({ type: "solve-mechanism", requestId: "second", inputBytes: new TextEncoder().encode("{}") });
    expect(scope.messages[0]!.value).toEqual({ type: "failed", requestId: "second",
      error: "Mechanism solver worker is already active" });
    finish(output);
    await vi.waitFor(() => expect(scope.messages).toHaveLength(2));
    expect((scope.messages[1]!.value as { requestId: string }).requestId).toBe("first");
  });

  test("checks cancellation after an uncooperative solve await and emits one terminal", async () => {
    const scope = new Scope();
    let finish!: (value: typeof output) => void;
    createMechanismSolverWorkerRuntime(scope, async () => new Promise((resolve) => { finish = resolve; }));
    scope.send({ type: "solve-mechanism", requestId: "late", inputBytes: new TextEncoder().encode("{}") });
    scope.send({ type: "cancel", requestId: "late" });
    finish(output);
    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));
    expect(scope.messages[0]!.value).toEqual({ type: "cancelled", requestId: "late" });
  });

  test.each([
    ["invalid JSON", new TextEncoder().encode("{"), "JSON"],
    ["invalid solver output", new TextEncoder().encode("{}"), "expected object"],
  ])("reports %s as a bounded failure", async (_label, inputBytes, message) => {
    const scope = new Scope();
    createMechanismSolverWorkerRuntime(scope, async () => ({}) as never);
    scope.send({ type: "solve-mechanism", requestId: "failure", inputBytes });
    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));
    expect(scope.messages[0]!.value).toMatchObject({ type: "failed", requestId: "failure",
      error: expect.stringContaining(message) });
  });
});
