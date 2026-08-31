import { describe, expect, it } from "vitest";

import { createArtifactIndex, type ArtifactRecord } from "../cad/artifact-contract";
import { CadResourceLimitError } from "../cad/cad-resource-limits";
import { createArtifactStore } from "./artifact-store";
import { generatedArtifactDependencyError } from "./generated-artifact-dependencies";
import { createEngineeringJobRunner } from "./job-runner";
import {
  adapter,
  artifactForResult,
  bytes,
  request,
  resultFor,
  sourceDocument,
  studyDependency,
} from "./job-runner-test-fixtures";
import { createSolverRegistry } from "./solver-registry";

describe("engineering job runner result and subscriber contracts", () => {
  it("delivers a typed topology partial with its structural result digest intact", async () => {
    const document = await sourceDocument();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest, _signal, emit) => {
      emit({
        progress: 0.5,
        partial: {
          kind: "topology-objective-history",
          samples: [{
            iteration: 0, objectiveJ: 12,
            maskDigest: "a".repeat(64), structuralResultDigest: "b".repeat(64),
          }],
        },
      });
      return resultFor(solveRequest);
    }));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const delivered: unknown[] = [];
    runner.subscribe(({ event }) => { if (event.state === "partial") delivered.push(event.partial); });

    await runner.launch(await request(document, "typed-topology-partial")).completion;

    expect(delivered).toEqual([{
      kind: "topology-objective-history",
      samples: [{
        iteration: 0, objectiveJ: 12,
        maskDigest: "a".repeat(64), structuralResultDigest: "b".repeat(64),
      }],
    }]);
  });

  it("accepts generated artifacts with closed study and artifact dependencies", async () => {
    const document = await sourceDocument();
    const seedRequest = await request(document, "closed-generated-dependencies");
    const input = await artifactForResult(seedRequest, bytes(3));
    const solveRequest = await request(document, "closed-generated-dependencies", [input]);
    const firstPayload = bytes(4);
    const first = await artifactForResult(solveRequest, firstPayload, [
      ...studyDependency(solveRequest), { kind: "artifact", artifactId: input.id },
    ]);
    const secondPayload = bytes(5);
    const second = await artifactForResult(solveRequest, secondPayload, [
      ...studyDependency(solveRequest), { kind: "artifact", artifactId: first.id },
    ]);
    const registry = createSolverRegistry();
    registry.register(adapter(async () => ({
      output: { status: "complete" }, truthLevel: "converged-numerical-solve",
      artifacts: [{ record: first, payload: firstPayload }, { record: second, payload: secondPayload }],
    })));
    const store = createArtifactStore();
    const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => document });

    const completion = await runner.launch(solveRequest).completion;

    expect(completion).toMatchObject({ event: { state: "verified" } });
    createArtifactIndex(document.revision, [input, first, second]);
    await expect(store.get(first.id)).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(store.get(second.id)).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("rejects generated artifacts without resolved study ownership before a write", async () => {
    const document = await sourceDocument();
    const cases = [
      { jobId: "missing-study-ownership", dependencies: [] },
      { jobId: "foreign-entity", dependencies: [{ kind: "entity", reference: "body:missing" }] },
      { jobId: "foreign-artifact", dependencies: [
        { kind: "entity", reference: "study:link-static" },
        { kind: "artifact", artifactId: "f".repeat(64) },
      ] },
    ];

    for (const testCase of cases) {
      const solveRequest = await request(document, testCase.jobId);
      const artifact = await artifactForResult(solveRequest, bytes(6), testCase.dependencies);
      const registry = createSolverRegistry();
      registry.register(adapter(async () => ({
        output: { status: "complete" }, truthLevel: "converged-numerical-solve",
        artifacts: [{ record: artifact, payload: bytes(6) }],
      })));
      const store = createArtifactStore();
      const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => document });

      const completion = await runner.launch(solveRequest).completion;

      expect(completion).toMatchObject({ event: { state: "failed", error: { code: "invalid-input" } } });
      await expect(store.get(artifact.id)).resolves.toBeUndefined();
    }
  });

  it("rejects self and cyclic generated dependencies before an artifact store can observe them", async () => {
    const document = await sourceDocument();
    const solveRequest = await request(document, "cyclic-generated-dependencies");
    const first = await artifactForResult(solveRequest, bytes(7));
    const second = await artifactForResult(solveRequest, bytes(8));
    const self = {
      ...first,
      dependencies: [...studyDependency(solveRequest), { kind: "artifact", artifactId: first.id }],
    } as unknown as ArtifactRecord;
    const cycle = [
      { ...first, dependencies: [...studyDependency(solveRequest), { kind: "artifact", artifactId: second.id }] },
      { ...second, dependencies: [...studyDependency(solveRequest), { kind: "artifact", artifactId: first.id }] },
    ] as unknown as readonly ArtifactRecord[];

    expect(generatedArtifactDependencyError(solveRequest, [self])).toMatch(/itself/i);
    expect(generatedArtifactDependencyError(solveRequest, cycle)).toMatch(/cycle/i);
  });

  it("maps typed resource, device, and divergence adapter errors without collapsing them", async () => {
    const document = await sourceDocument();
    const cases = [
      { jobId: "resource-error", error: new CadResourceLimitError("solver cells", 2, 1), code: "resource-limit" },
      { jobId: "device-error", error: Object.assign(new Error("device lost"), { code: "device-lost" }), code: "device-lost" },
      { jobId: "diverged-error", error: Object.assign(new Error("solver diverged"), { code: "diverged" }), code: "diverged" },
    ] as const;

    for (const testCase of cases) {
      const registry = createSolverRegistry();
      registry.register(adapter(async () => { throw testCase.error; }));
      const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });

      await expect(runner.launch(await request(document, testCase.jobId)).completion)
        .resolves.toMatchObject({ event: { state: "failed", error: { code: testCase.code } } });
    }
  });

  it("delivers each ledger sequence to every subscriber before reentrant cancellation", async () => {
    const document = await sourceDocument();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => resultFor(solveRequest)));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const calls: string[] = [];
    runner.subscribe(({ event }) => {
      calls.push(`first:${event.state}`);
      if (event.state === "queued") runner.cancel(event.jobId);
    });
    runner.subscribe(({ event }) => calls.push(`second:${event.state}`));

    const handle = runner.launch(await request(document, "reentrant-cancel"));

    await expect(handle.completion).resolves.toMatchObject({ event: { state: "cancelled" } });
    expect(calls).toEqual([
      "first:queued", "second:queued", "first:cancelled", "second:cancelled",
    ]);
  });

  it("queues reentrant cancellation from running and partial delivery", async () => {
    const document = await sourceDocument();
    for (const state of ["running", "partial"] as const) {
      const registry = createSolverRegistry();
      registry.register(adapter(async (solveRequest, _signal, emit) => {
        if (state === "partial") emit({ progress: 0.5 });
        return resultFor(solveRequest);
      }));
      const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
      const calls: string[] = [];
      runner.subscribe(({ event }) => {
        calls.push(`first:${event.state}`);
        if (event.state === state) runner.cancel(event.jobId);
      });
      runner.subscribe(({ event }) => calls.push(`second:${event.state}`));

      await expect(runner.launch(await request(document, `reentrant-${state}`)).completion)
        .resolves.toMatchObject({ event: { state: "cancelled" } });
      const states = state === "running" ? ["queued", "running", "cancelled"] : ["queued", "running", "partial", "cancelled"];
      expect(calls).toEqual(states.flatMap((entry) => [`first:${entry}`, `second:${entry}`]));
    }
  });

  it("takes one subscriber snapshot per delivery while subscriptions change", async () => {
    const document = await sourceDocument();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => resultFor(solveRequest)));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const calls: string[] = [];
    let unsubscribeSecond: () => void = () => undefined;
    runner.subscribe(({ event }) => {
      calls.push(`first:${event.state}`);
      if (event.state === "queued") {
        unsubscribeSecond();
        runner.subscribe((next) => calls.push(`third:${next.event.state}`));
      }
    });
    unsubscribeSecond = runner.subscribe(({ event }) => calls.push(`second:${event.state}`));

    await runner.launch(await request(document, "subscription-snapshot")).completion;

    expect(calls).toEqual([
      "first:queued", "second:queued", "first:running", "third:running",
      "first:verified", "third:verified",
    ]);
  });

  it("isolates a throwing subscriber without losing ordered delivery", async () => {
    const document = await sourceDocument();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => resultFor(solveRequest)));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const delivered: string[] = [];
    runner.subscribe(() => { throw new Error("render failure"); });
    runner.subscribe(({ event }) => delivered.push(event.state));

    await expect(runner.launch(await request(document, "throwing-subscriber")).completion)
      .resolves.toMatchObject({ event: { state: "verified" } });
    expect(delivered).toEqual(["queued", "running", "verified"]);
  });
});
