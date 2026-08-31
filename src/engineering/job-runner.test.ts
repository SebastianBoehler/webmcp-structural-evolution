import { describe, expect, it } from "vitest";

import { defineArtifactRecord } from "../cad/artifact-contract";
import { defineDesignDocument, type DesignDocument } from "../cad/document-schema";
import { defineEngineeringSolveRequest } from "../cad/engineering-job-contract";
import { createSolverRegistry } from "./solver-registry";
import type { EngineeringSolveRequest, SolverAdapter, SolverRunResult } from "./solver-adapter";
import { createArtifactStore, type ArtifactPayload, type ArtifactStore } from "./artifact-store";
import { createEngineeringJobRunner } from "./job-runner";

const human = { kind: "human", id: "sebastian" } as const;

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer as ArrayBuffer;
}

async function sourceDocument(label = "Link"): Promise<DesignDocument> {
  return defineDesignDocument({
    id: "link",
    label,
    schemaVersion: 3,
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: human,
    frames: [{
      id: "world",
      label: "World",
      transform: {
        position: {
          x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" },
        },
        orientation: {
          roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" },
        },
      },
    }],
    parameters: [],
    sketches: [{
      id: "link-profile",
      plane: "frame:world",
      entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.1, 0.02] }],
      constraints: [],
    }],
    features: [{ id: "link-feature", kind: "extrude", sketchId: "link-profile", distanceM: 0.01 }],
    bodies: [{ id: "link-body", featureId: "link-feature" }],
    components: [],
    instances: [],
    mates: [],
    namedSelections: ["fixed-end", "tip"].map((id, index) => ({
      id,
      reference: {
        bodyId: "link-body",
        ownerFeatureId: "link-feature",
        expectedKind: "face",
        stableId: `face:link-body:${id}`,
        signature: {
          geometry: "plane", centroidM: [index * 0.1, 0, 0], measureSI: 0.0002, adjacentKinds: ["plane"],
        },
      },
    })),
    materials: [{
      id: "al-6061", kind: "isotropic", densityKgM3: 2700, youngsModulusPa: 68.9e9,
      poissonRatio: 0.33, failureStressPa: 276e6,
    }],
    studies: [{
      id: "link-static", kind: "structural-linear", bodyIds: ["link-body"], materialId: "al-6061",
      supports: ["fixed-end"], loads: [{ selectionId: "tip", forceN: [0, -500, 0] }],
    }],
  });
}

async function request(
  document: DesignDocument,
  jobId: string,
): Promise<EngineeringSolveRequest<{ readonly grid: readonly [number, number, number] }>> {
  return defineEngineeringSolveRequest({
    jobId,
    kind: "fea",
    sourceRevision: document.revision,
    inputArtifacts: [],
    settings: {},
    studyId: "link-static",
    input: { grid: [8, 4, 2] },
    document,
  });
}

async function resultFor(
  requestValue: EngineeringSolveRequest<unknown>,
  payload: ArtifactPayload = bytes(1, 2, 3),
): Promise<SolverRunResult<{ readonly status: "complete" }>> {
  const { digestArtifactPayload } = await import("./artifact-store");
  const record = await defineArtifactRecord({
    kind: "field",
    sourceRevision: requestValue.sourceRevision,
    producer: { name: "structural-adapter", version: "1.0.0" },
    settingsDigest: "b".repeat(64),
    contentDigest: await digestArtifactPayload(payload),
    units: "m",
    mediaType: "application/vnd.engineering.field",
    dependencies: [],
  });
  return {
    output: { status: "complete" },
    truthLevel: "converged-numerical-solve",
    artifacts: [{ record, payload }],
  };
}

function adapter(
  run: SolverAdapter<{ readonly grid: readonly [number, number, number] }, { readonly status: "complete" }> ["run"],
  supported = true,
): SolverAdapter<{ readonly grid: readonly [number, number, number] }, { readonly status: "complete" }> {
  return {
    capability: { kind: "fea" },
    supports: () => supported
      ? { supported: true }
      : {
        supported: false,
        error: {
          code: "unsupported-capability",
          message: "Grid exceeds the bounded adapter envelope",
          limit: { kind: "dimension", rule: "width must be at most 128" },
        },
      },
    run,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  return {
    promise: new Promise<Value>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; }),
    resolve,
    reject,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for solver adapter dispatch");
}

describe("engineering job runner", () => {
  it("reserves IDs synchronously and rejects duplicate launches", async () => {
    const document = await sourceDocument();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => resultFor(solveRequest)));
    const runner = createEngineeringJobRunner({
      registry,
      store: createArtifactStore(),
      currentDocument: () => document,
    });
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

  it("quarantines late progress and success after cancellation during a run", async () => {
    const document = await sourceDocument();
    const pending = deferred<SolverRunResult<{ readonly status: "complete" }>>();
    let started = false;
    let signal: AbortSignal | undefined;
    let emitProgress: ((event: { readonly progress: number }) => void) | undefined;
    const store = createArtifactStore();
    const registry = createSolverRegistry();
    registry.register(adapter(async (_solveRequest, adapterSignal, emit) => {
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

  it("maps adapter exceptions and registry capability failures to typed failed terminals", async () => {
    const document = await sourceDocument();
    const throwingRegistry = createSolverRegistry();
    throwingRegistry.register(adapter(async () => { throw new Error("device disappeared"); }));
    const throwingRunner = createEngineeringJobRunner({
      registry: throwingRegistry, store: createArtifactStore(), currentDocument: () => document,
    });
    const missingRunner = createEngineeringJobRunner({
      registry: createSolverRegistry(), store: createArtifactStore(), currentDocument: () => document,
    });
    const unsupportedRegistry = createSolverRegistry();
    unsupportedRegistry.register(adapter(async (solveRequest) => resultFor(solveRequest), false));
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

  it("maps a generated artifact digest mismatch to a typed failure without committing it", async () => {
    const document = await sourceDocument();
    const payload = bytes(4, 5, 6);
    const record = await defineArtifactRecord({
      kind: "field",
      sourceRevision: document.revision,
      producer: { name: "structural-adapter", version: "1.0.0" },
      settingsDigest: "b".repeat(64),
      contentDigest: "f".repeat(64),
      units: "m",
      mediaType: "application/vnd.engineering.field",
      dependencies: [],
    });
    const registry = createSolverRegistry();
    registry.register(adapter(async () => ({
      output: { status: "complete" },
      truthLevel: "converged-numerical-solve",
      artifacts: [{ record, payload }],
    })));
    const store = createArtifactStore();
    const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => document });

    const completion = await runner.launch(await request(document, "artifact-digest-mismatch")).completion;

    expect(completion).toMatchObject({ event: { state: "failed", error: { code: "invalid-input" } } });
    await expect(store.get(record.id)).resolves.toBeUndefined();
  });

  it("fails stale jobs before dispatch and again before artifact commit", async () => {
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
    const beforeCommitRegistry = createSolverRegistry();
    beforeCommitRegistry.register(adapter(async () => {
      started = true;
      return pending.promise;
    }));
    const beforeCommitRunner = createEngineeringJobRunner({
      registry: beforeCommitRegistry, store, currentDocument: () => current,
    });
    const solveRequest = await request(document, "stale-before-commit");
    const beforeCommit = beforeCommitRunner.launch(solveRequest);
    await waitFor(() => started);
    const late = await resultFor(solveRequest);
    current = revised;
    pending.resolve(late);

    await expect(beforeCommit.completion).resolves.toMatchObject({ event: {
      state: "failed", error: { code: "stale-revision" },
    } });
    await expect(store.get(late.artifacts[0].record.id)).resolves.toBeUndefined();
  });

  it("checks the current revision immediately before invoking an adapter", async () => {
    const document = await sourceDocument();
    const revised = await sourceDocument("Revised link");
    let current = document;
    let runs = 0;
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => {
      runs += 1;
      return resultFor(solveRequest);
    }));
    const runner = createEngineeringJobRunner({
      registry, store: createArtifactStore(), currentDocument: () => current,
    });
    runner.subscribe(({ event }) => {
      if (event.state === "running") current = revised;
    });

    const completion = await runner.launch(await request(document, "stale-before-run")).completion;

    expect(completion).toMatchObject({ event: {
      state: "failed", error: { code: "stale-revision" },
    } });
    expect(runs).toBe(0);
  });

  it("maps store commit failures to one failed terminal", async () => {
    const document = await sourceDocument();
    const backing = createArtifactStore();
    const failingStore: ArtifactStore = {
      get: backing.get,
      delete: backing.delete,
      put: async () => { throw new Error("quota exhausted"); },
    };
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => resultFor(solveRequest)));
    const runner = createEngineeringJobRunner({
      registry, store: failingStore, currentDocument: () => document,
    });

    const completion = await runner.launch(await request(document, "commit-failure")).completion;

    expect(completion).toMatchObject({ event: { state: "failed", error: { code: "internal-error" } } });
    expect(runner.entries().filter(({ event }) => ["verified", "failed", "cancelled"].includes(event.state)))
      .toHaveLength(1);
  });

  it("publishes frozen entries to subscribers in registration order", async () => {
    const document = await sourceDocument();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest, _signal, emit) => {
      emit({ progress: 0.5 });
      return resultFor(solveRequest);
    }));
    const runner = createEngineeringJobRunner({
      registry, store: createArtifactStore(), currentDocument: () => document,
    });
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
