import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import type { EngineeringSolveRequest } from "../cad/engineering-job-contract";
import { createArtifactStore } from "./artifact-store";
import { createEngineeringJobRunner } from "./job-runner";
import { adapter, request, resultFor, sourceDocument } from "./job-runner-test-fixtures";
import { createSolverRegistry } from "./solver-registry";

type RequestPatch = Readonly<Record<string, unknown>>;

function crossRealm<Value>(expression: string, sandbox: object = {}): Value {
  return runInNewContext(expression, sandbox) as Value;
}

function rejectingRunner(document: Awaited<ReturnType<typeof sourceDocument>>) {
  let runs = 0;
  const registry = createSolverRegistry();
  registry.register(adapter(async (solveRequest) => {
    runs += 1;
    return resultFor(solveRequest);
  }));
  return {
    runner: createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document }),
    runs: () => runs,
  };
}

async function expectRejectedBeforeReservation(
  document: Awaited<ReturnType<typeof sourceDocument>>,
  jobId: string,
  patch: RequestPatch,
): Promise<void> {
  const { runner, runs } = rejectingRunner(document);
  const candidate = { ...await request(document, jobId), ...patch } as EngineeringSolveRequest<unknown>;
  let failure: unknown;
  try {
    runner.launch(candidate);
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ code: "invalid-input" });
  expect(runner.entries()).toEqual([]);
  expect(runs()).toBe(0);
}

describe("cross-realm engineering job snapshots", () => {
  it("rejects cross-realm shared buffers and views before reservation", async () => {
    const document = await sourceDocument();
    await expectRejectedBeforeReservation(document, "cross-sab", {
      input: { nested: crossRealm("new SharedArrayBuffer(4)") },
    });
    await expectRejectedBeforeReservation(document, "cross-typed-view", {
      settings: { nested: crossRealm("new Uint8Array(new SharedArrayBuffer(4))") },
    });
    await expectRejectedBeforeReservation(document, "cross-data-view", {
      document: { ...structuredClone(document), nested: crossRealm("new DataView(new SharedArrayBuffer(4))") },
    });
  });

  it("rejects shared internal Map and Set entries without public iteration", async () => {
    const document = await sourceDocument();
    await expectRejectedBeforeReservation(document, "cross-map", {
      input: { nested: crossRealm("new Map([[\"shared\", new Uint8Array(new SharedArrayBuffer(4))]])") },
    });
    await expectRejectedBeforeReservation(document, "cross-set", {
      settings: { nested: crossRealm("new Set([new DataView(new SharedArrayBuffer(4))])") },
    });

    let mapIteratorReads = 0;
    const concealedMap = new Map([["shared", new Uint8Array(new SharedArrayBuffer(4))]]);
    const concealedMapPrototype = Object.create(Map.prototype);
    Object.defineProperty(concealedMapPrototype, Symbol.iterator, {
      get: () => {
        mapIteratorReads += 1;
        return function* empty(): Generator<never> {};
      },
    });
    Object.setPrototypeOf(concealedMap, concealedMapPrototype);
    await expectRejectedBeforeReservation(document, "concealed-map", { input: { nested: concealedMap } });

    let setIteratorReads = 0;
    const concealedSet = new Set([new DataView(new SharedArrayBuffer(4))]);
    const concealedSetPrototype = Object.create(Set.prototype);
    Object.defineProperty(concealedSetPrototype, Symbol.iterator, {
      get: () => {
        setIteratorReads += 1;
        return function* empty(): Generator<never> {};
      },
    });
    Object.setPrototypeOf(concealedSet, concealedSetPrototype);
    await expectRejectedBeforeReservation(document, "concealed-set", { settings: { nested: concealedSet } });

    const mapWithOwnSharedState = new Map();
    Object.defineProperty(mapWithOwnSharedState, "shared", { value: new SharedArrayBuffer(4) });
    await expectRejectedBeforeReservation(document, "map-own-shared", { input: { nested: mapWithOwnSharedState } });

    const setWithOwnSharedState = new Set();
    Object.defineProperty(setWithOwnSharedState, "shared", { value: new SharedArrayBuffer(4) });
    await expectRejectedBeforeReservation(document, "set-own-shared", { settings: { nested: setWithOwnSharedState } });

    expect(mapIteratorReads).toBe(0);
    expect(setIteratorReads).toBe(0);
  });

  it("rejects accessor-smuggled cross-realm shared memory without evaluating it", async () => {
    const document = await sourceDocument();
    const sandbox = { reads: 0 };
    const accessor = crossRealm("({ get shared() { reads += 1; return new SharedArrayBuffer(4); } })", sandbox);

    await expectRejectedBeforeReservation(document, "cross-accessor", { input: accessor });

    expect(sandbox.reads).toBe(0);
  });

  it("privately clones ordinary cross-realm buffers in Maps and Sets", async () => {
    const document = await sourceDocument();
    const solveRequest = await request(document, "cross-ordinary-copy");
    const input = crossRealm<{
      grid: [number, number, number]; bytes: Uint8Array; entries: Map<string, Uint8Array>; values: Set<Uint8Array>;
      impostor: { byteLength: number; buffer: { byteLength: number } };
    }>("({ grid: [8, 4, 2], bytes: new Uint8Array([1, 2]), entries: new Map([[\"map\", new Uint8Array([3, 4])]]), values: new Set([new Uint8Array([5, 6])]), impostor: { byteLength: 4, buffer: { byteLength: 4 }, [Symbol.toStringTag]: \"SharedArrayBuffer\" } })");
    let observed: Record<string, number> | undefined;
    const registry = createSolverRegistry();
    registry.register(adapter(async (adapterRequest) => {
      const snapshot = adapterRequest.input as typeof input;
      observed = {
        bytes: snapshot.bytes[0],
        map: snapshot.entries.get("map")![0],
        set: snapshot.values.values().next().value![0],
        impostor: snapshot.impostor.byteLength,
      };
      return resultFor(adapterRequest);
    }));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const handle = runner.launch({ ...solveRequest, input } as EngineeringSolveRequest<unknown>);

    input.bytes[0] = 9;
    Map.prototype.get.call(input.entries, "map")![0] = 9;
    Set.prototype.values.call(input.values).next().value![0] = 9;

    await expect(handle.completion).resolves.toMatchObject({ event: { state: "verified" } });
    expect(observed).toEqual({ bytes: 1, map: 3, set: 5, impostor: 4 });
  });
});
