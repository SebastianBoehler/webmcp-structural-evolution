import { describe, expect, it } from "vitest";

import { defineArtifactRecord } from "../cad/artifact-contract";
import type { ArtifactPayload, ArtifactStore } from "./artifact-store";
import { createArtifactStore } from "./artifact-store";
import { createEngineeringJobRunner } from "./job-runner";
import {
  adapter,
  bytes,
  deferred,
  request,
  resultFor,
  sourceDocument,
  studyDependency,
  waitFor,
} from "./job-runner-test-fixtures";
import { createSolverRegistry } from "./solver-registry";
import type { SolverRunResult } from "./solver-adapter";

describe("engineering job runner lifecycle", () => {
  it("reserves IDs synchronously and rejects duplicate launches", async () => {
    const document = await sourceDocument();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => resultFor(solveRequest)));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const solveRequest = await request(document, "duplicate-job");

    const first = runner.launch(solveRequest);

    expect(runner.entries()).toMatchObject([{ event: { jobId: "duplicate-job", state: "queued" } }]);
    expect(() => runner.launch(solveRequest)).toThrow(/duplicate/i);
    await expect(first.completion).resolves.toMatchObject({ event: { state: "verified" } });
  });

  it("cancels before dispatch without invoking the adapter", async () => {
    const document = await sourceDocument();
    let runs = 0;
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => {
      runs += 1;
      return resultFor(solveRequest);
    }));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const handle = runner.launch(await request(document, "cancel-before-dispatch"));

    expect(runner.cancel(handle.jobId)).toBe(true);
    await expect(handle.completion).resolves.toMatchObject({ event: { state: "cancelled" } });
    await Promise.resolve();

    expect(runs).toBe(0);
    expect(runner.entries().map(({ event }) => event.state)).toEqual(["queued", "cancelled"]);
  });

  it("rejects a snapshot whose document and source revision are not bound", async () => {
    const document = await sourceDocument();
    const revised = await sourceDocument("Revised link");
    let runs = 0;
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => {
      runs += 1;
      return resultFor(solveRequest);
    }));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const malformed = { ...await request(document, "unbound-snapshot"), sourceRevision: revised.revision };

    await expect(runner.launch(malformed).completion).resolves.toMatchObject({ event: {
      state: "failed", error: { code: "invalid-input" },
    } });
    expect(runs).toBe(0);
  });

  it("quarantines late progress and success after cancellation during a run", async () => {
    const document = await sourceDocument();
    const pending = deferred<SolverRunResult<{ readonly status: "complete" }>>();
    let started = false;
    let signal: AbortSignal | undefined;
    let emitProgress: ((event: { readonly progress: number }) => void) | undefined;
    const store = createArtifactStore();
    const registry = createSolverRegistry();
    registry.register(adapter(async (_request, adapterSignal, emit) => {
      started = true;
      signal = adapterSignal;
      emitProgress = emit;
      return pending.promise;
    }));
    const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => document });
    const solveRequest = await request(document, "cancel-during-run");
    const handle = runner.launch(solveRequest);
    await waitFor(() => started);
    const late = await resultFor(solveRequest);

    expect(runner.cancel(handle.jobId)).toBe(true);
    expect(signal?.aborted).toBe(true);
    emitProgress?.({ progress: 0.9 });
    pending.resolve(late);
    await expect(handle.completion).resolves.toMatchObject({ event: { state: "cancelled" } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(runner.entries().map(({ event }) => event.state)).toEqual(["queued", "running", "cancelled"]);
    await expect(store.get(late.artifacts[0].record.id)).resolves.toBeUndefined();
  });

  it("maps adapter, registry, and capability failures to typed terminals", async () => {
    const document = await sourceDocument();
    const throwingRegistry = createSolverRegistry();
    throwingRegistry.register(adapter(async () => { throw new Error("device disappeared"); }));
    const missingRunner = createEngineeringJobRunner({
      registry: createSolverRegistry(), store: createArtifactStore(), currentDocument: () => document,
    });
    const unsupportedRegistry = createSolverRegistry();
    unsupportedRegistry.register(adapter(async (solveRequest) => resultFor(solveRequest), false));
    const throwingRunner = createEngineeringJobRunner({
      registry: throwingRegistry, store: createArtifactStore(), currentDocument: () => document,
    });
    const unsupportedRunner = createEngineeringJobRunner({
      registry: unsupportedRegistry, store: createArtifactStore(), currentDocument: () => document,
    });

    await expect(throwingRunner.launch(await request(document, "adapter-error")).completion)
      .resolves.toMatchObject({ event: { state: "failed", error: { code: "internal-error" } } });
    await expect(missingRunner.launch(await request(document, "missing-adapter")).completion)
      .resolves.toMatchObject({ event: { state: "failed", error: { code: "invalid-input" } } });
    await expect(unsupportedRunner.launch(await request(document, "unsupported-adapter")).completion)
      .resolves.toMatchObject({ event: {
        state: "failed", error: { code: "unsupported-capability", limit: { kind: "dimension" } },
      } });
  });

  it("maps generated digest mismatches to a failure without committing", async () => {
    const document = await sourceDocument();
    const payload = bytes(4, 5, 6);
    const record = await defineArtifactRecord({
      kind: "field", sourceRevision: document.revision,
      producer: { name: "structural-adapter", version: "1.0.0" }, settingsDigest: "b".repeat(64),
      contentDigest: "f".repeat(64), units: "m", mediaType: "application/vnd.engineering.field",
      dependencies: [{ kind: "entity", reference: "study:link-static" }],
    });
    const registry = createSolverRegistry();
    registry.register(adapter(async () => ({
      output: { status: "complete" }, truthLevel: "converged-numerical-solve", artifacts: [{ record, payload }],
    })));
    const store = createArtifactStore();
    const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => document });

    const completion = await runner.launch(await request(document, "artifact-digest-mismatch")).completion;

    expect(completion).toMatchObject({ event: { state: "failed", error: { code: "invalid-input" } } });
    await expect(store.get(record.id)).resolves.toBeUndefined();
  });

  it("fails stale jobs before dispatch, immediately before run, and before commit", async () => {
    const document = await sourceDocument();
    const revised = await sourceDocument("Revised link");
    let current = document;
    let beforeDispatchRuns = 0;
    const beforeDispatchRegistry = createSolverRegistry();
    beforeDispatchRegistry.register(adapter(async (solveRequest) => {
      beforeDispatchRuns += 1;
      return resultFor(solveRequest);
    }));
    const beforeDispatchRunner = createEngineeringJobRunner({
      registry: beforeDispatchRegistry, store: createArtifactStore(), currentDocument: () => current,
    });
    const beforeDispatch = beforeDispatchRunner.launch(await request(document, "stale-before-dispatch"));
    current = revised;
    await expect(beforeDispatch.completion).resolves.toMatchObject({ event: {
      state: "failed", error: { code: "stale-revision" },
    } });
    expect(beforeDispatchRuns).toBe(0);

    current = document;
    const pending = deferred<SolverRunResult<{ readonly status: "complete" }>>();
    let started = false;
    const store = createArtifactStore();
    const registry = createSolverRegistry();
    registry.register(adapter(async () => {
      started = true;
      return pending.promise;
    }));
    const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => current });
    const solveRequest = await request(document, "stale-before-commit");
    const beforeCommit = runner.launch(solveRequest);
    await waitFor(() => started);
    current = revised;
    pending.resolve(await resultFor(solveRequest));
    await expect(beforeCommit.completion).resolves.toMatchObject({ event: {
      state: "failed", error: { code: "stale-revision" },
    } });

    current = document;
    let runs = 0;
    const beforeRunRegistry = createSolverRegistry();
    beforeRunRegistry.register(adapter(async (solveRequest) => {
      runs += 1;
      return resultFor(solveRequest);
    }));
    const beforeRunRunner = createEngineeringJobRunner({
      registry: beforeRunRegistry, store: createArtifactStore(), currentDocument: () => current,
    });
    beforeRunRunner.subscribe(({ event }) => { if (event.state === "running") current = revised; });
    await expect(beforeRunRunner.launch(await request(document, "stale-before-run")).completion)
      .resolves.toMatchObject({ event: { state: "failed", error: { code: "stale-revision" } } });
    expect(runs).toBe(0);
  });

  it("maps a generic store commit failure to one failed terminal", async () => {
    const document = await sourceDocument();
    const backing = createArtifactStore();
    const failingStore = {
      get: backing.get,
      delete: backing.delete,
      put: async () => { throw new Error("quota exhausted"); },
      commit: async () => { throw new Error("quota exhausted"); },
    } as ArtifactStore;
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => resultFor(solveRequest)));
    const runner = createEngineeringJobRunner({ registry, store: failingStore, currentDocument: () => document });

    const completion = await runner.launch(await request(document, "commit-failure")).completion;

    expect(completion).toMatchObject({ event: { state: "failed", error: { code: "internal-error" } } });
    expect(runner.entries().filter(({ event }) => ["verified", "failed", "cancelled"].includes(event.state))).toHaveLength(1);
  });

  it("publishes frozen entries to subscribers in registration order", async () => {
    const document = await sourceDocument();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest, _signal, emit) => {
      emit({ progress: 0.5 });
      return resultFor(solveRequest);
    }));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const calls: string[] = [];
    runner.subscribe((entry) => calls.push(`first:${entry.event.state}`));
    runner.subscribe((entry) => calls.push(`second:${entry.event.state}`));

    await runner.launch(await request(document, "subscriber-order")).completion;
    const entries = runner.entries();

    expect(calls).toEqual([
      "first:queued", "second:queued", "first:running", "second:running",
      "first:partial", "second:partial", "first:verified", "second:verified",
    ]);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(entries.every((entry) => Object.isFrozen(entry) && Object.isFrozen(entry.event))).toBe(true);
  });
});
