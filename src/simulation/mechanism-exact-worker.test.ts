import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CadEvaluationEvent, CadEvaluationRequest } from "../cad/runtime-contracts";

const createAdapter = vi.hoisted(() => vi.fn());
vi.mock("../cad/kernel/occt-adapter", () => ({ createOcctCadAdapter: createAdapter }));

import { evaluateMechanismExactRequest } from "./mechanism-exact-worker";

const request = {} as CadEvaluationRequest;
const signal = new AbortController().signal;
type Emit = (event: CadEvaluationEvent) => void;
const emit: Emit = (_event) => undefined;

type ExactAdapter = {
  evaluate: (request: CadEvaluationRequest, signal: AbortSignal, emit: Emit) => Promise<void>;
  dispose: ReturnType<typeof vi.fn>;
};

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function adapter(evaluate: ExactAdapter["evaluate"], dispose = vi.fn()): ExactAdapter {
  return { evaluate, dispose };
}

describe("mechanism exact worker ownership", () => {
  beforeEach(() => createAdapter.mockReset());

  it("creates a fresh adapter and disposes it only after each successful evaluation settles", async () => {
    const first = deferred(), second = deferred();
    const firstAdapter = adapter(() => first.promise);
    const secondAdapter = adapter(() => second.promise);
    createAdapter.mockReturnValueOnce(firstAdapter).mockReturnValueOnce(secondAdapter);

    const firstRun = evaluateMechanismExactRequest(request, signal, emit);
    expect(firstAdapter.dispose).not.toHaveBeenCalled();
    first.resolve();
    await firstRun;
    expect(firstAdapter.dispose).toHaveBeenCalledOnce();

    const secondRun = evaluateMechanismExactRequest(request, signal, emit);
    expect(secondAdapter.dispose).not.toHaveBeenCalled();
    second.resolve();
    await secondRun;

    expect(createAdapter).toHaveBeenCalledTimes(2);
    expect(secondAdapter.dispose).toHaveBeenCalledOnce();
  });

  it("keeps successful evaluation semantics when cleanup throws", async () => {
    const owned = adapter(async () => undefined, vi.fn(() => { throw new Error("dispose failed"); }));
    createAdapter.mockReturnValueOnce(owned);

    await expect(evaluateMechanismExactRequest(request, signal, emit)).resolves.toBeUndefined();

    expect(owned.dispose).toHaveBeenCalledOnce();
  });

  it("keeps failed evaluation semantics when cleanup throws", async () => {
    const failure = new Error("exact compilation failed");
    const owned = adapter(async () => { throw failure; }, vi.fn(() => { throw new Error("dispose failed"); }));
    createAdapter.mockReturnValueOnce(owned);

    await expect(evaluateMechanismExactRequest(request, signal, emit)).rejects.toBe(failure);

    expect(owned.dispose).toHaveBeenCalledOnce();
  });

  it("preserves a cancellation terminal event when cleanup throws", async () => {
    const events: CadEvaluationEvent[] = [];
    const owned = adapter(async (activeRequest, _signal, activeEmit) => {
      activeEmit({ requestId: activeRequest.requestId, state: "cancelled", workerDisposition: "quarantined" });
    }, vi.fn(() => { throw new Error("dispose failed"); }));
    createAdapter.mockReturnValueOnce(owned);
    const cancelledRequest = { ...request, requestId: "cancelled-exact" } as CadEvaluationRequest;

    await expect(evaluateMechanismExactRequest(cancelledRequest, signal, (event) => events.push(event)))
      .resolves.toBeUndefined();

    expect(events).toEqual([
      { requestId: "cancelled-exact", state: "cancelled", workerDisposition: "quarantined" },
    ]);
    expect(owned.dispose).toHaveBeenCalledOnce();
  });
});
