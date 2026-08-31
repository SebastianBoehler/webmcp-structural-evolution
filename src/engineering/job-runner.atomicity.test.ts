import { describe, expect, it } from "vitest";

import { defineArtifactRecord, type ArtifactRecord } from "../cad/artifact-contract";
import type { ArtifactPayload, ArtifactStore } from "./artifact-store";
import { createArtifactStore } from "./artifact-store";
import { createEngineeringJobRunner } from "./job-runner";
import {
  adapter,
  artifactForResult,
  bytes,
  delayedBatchStore,
  request,
  resultFor,
  sourceDocument,
  studyDependency,
  waitFor,
} from "./job-runner-test-fixtures";
import { createSolverRegistry } from "./solver-registry";

describe("engineering job runner batch commit", () => {
  it("does not expose newly staged payloads when a later batch payload is invalid", async () => {
    const document = await sourceDocument();
    const solveRequest = await request(document, "atomic-invalid-batch");
    const store = createArtifactStore();
    const retainedPayload = bytes(9);
    const retained = await artifactForResult(solveRequest, retainedPayload);
    const stagedPayload = bytes(1);
    const staged = await artifactForResult(solveRequest, stagedPayload);
    const invalidPayload = bytes(2);
    const invalid = await defineArtifactRecord({
      kind: "field", sourceRevision: document.revision,
      producer: { name: "structural-adapter", version: "1.0.0" }, settingsDigest: "b".repeat(64),
      contentDigest: "f".repeat(64), units: "m", mediaType: "application/vnd.engineering.field",
      dependencies: studyDependency(solveRequest),
    });
    await store.put(retained, retainedPayload);
    const registry = createSolverRegistry();
    registry.register(adapter(async () => ({
      output: { status: "complete" },
      truthLevel: "converged-numerical-solve",
      artifacts: [
        { record: retained, payload: retainedPayload },
        { record: staged, payload: stagedPayload },
        { record: invalid, payload: invalidPayload },
      ],
    })));
    const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => document });

    const completion = await runner.launch(solveRequest).completion;

    expect(completion).toMatchObject({ event: { state: "failed", error: { code: "invalid-input" } } });
    await expect(store.get(retained.id)).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(store.get(staged.id)).resolves.toBeUndefined();
    await expect(store.get(invalid.id)).resolves.toBeUndefined();
  });

  it("does not expose staged payloads when a custom atomic commit rejects", async () => {
    const document = await sourceDocument();
    const solveRequest = await request(document, "atomic-store-failure");
    const payloads = new Map<string, ArtifactPayload>();
    const store = {
      async get(id: string): Promise<ArtifactPayload | undefined> {
        return payloads.get(id);
      },
      async delete(ids: readonly string[]): Promise<void> {
        for (const id of ids) payloads.delete(id);
      },
      async put(record: ArtifactRecord, payload: ArtifactPayload): Promise<void> {
        payloads.set(record.id, payload);
        if (payloads.size === 2) throw new Error("second write failed");
      },
      async commit(): Promise<void> {
        throw new Error("atomic commit failed");
      },
    } as unknown as ArtifactStore;
    const firstPayload = bytes(1);
    const secondPayload = bytes(2);
    const first = await artifactForResult(solveRequest, firstPayload);
    const second = await artifactForResult(solveRequest, secondPayload);
    const registry = createSolverRegistry();
    registry.register(adapter(async () => ({
      output: { status: "complete" }, truthLevel: "converged-numerical-solve",
      artifacts: [{ record: first, payload: firstPayload }, { record: second, payload: secondPayload }],
    })));
    const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => document });

    const completion = await runner.launch(solveRequest).completion;

    expect(completion).toMatchObject({ event: { state: "failed", error: { code: "internal-error" } } });
    expect(payloads.size).toBe(0);
  });

  it("keeps a delayed batch store unchanged when cancellation arrives before the commit fence", async () => {
    const document = await sourceDocument();
    const probe = delayedBatchStore();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => resultFor(solveRequest)));
    const runner = createEngineeringJobRunner({ registry, store: probe.store, currentDocument: () => document });
    const handle = runner.launch(await request(document, "cancel-during-commit"));
    await waitFor(probe.entered);

    expect(runner.cancel(handle.jobId)).toBe(true);
    probe.release();
    await expect(handle.completion).resolves.toMatchObject({ event: { state: "cancelled" } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(probe.payloads.size).toBe(0);
  });

  it("keeps a delayed batch store unchanged when the revision changes before the commit fence", async () => {
    const document = await sourceDocument();
    const revised = await sourceDocument("Revised link");
    let current = document;
    const probe = delayedBatchStore();
    const registry = createSolverRegistry();
    registry.register(adapter(async (solveRequest) => resultFor(solveRequest)));
    const runner = createEngineeringJobRunner({ registry, store: probe.store, currentDocument: () => current });
    const handle = runner.launch(await request(document, "stale-during-commit"));
    await waitFor(probe.entered);

    current = revised;
    probe.release();
    await expect(handle.completion).resolves.toMatchObject({ event: {
      state: "failed", error: { code: "stale-revision" },
    } });

    expect(probe.payloads.size).toBe(0);
  });

  it("uses a launch-time snapshot when callers mutate solve identity and inputs", async () => {
    const document = await sourceDocument();
    const revised = await sourceDocument("Revised link");
    const solveRequest = await request(document, "snapshot-mutable-request");
    let observed: Record<string, unknown> | undefined;
    const registry = createSolverRegistry();
    registry.register(adapter(async (adapterRequest) => {
      observed = adapterRequest;
      return resultFor(adapterRequest);
    }));
    const runner = createEngineeringJobRunner({ registry, store: createArtifactStore(), currentDocument: () => document });
    const handle = runner.launch(solveRequest);
    const mutable = solveRequest as unknown as {
      jobId: string;
      kind: "thermal";
      sourceRevision: string;
      document: typeof revised;
      settings: { changed: boolean };
      input: { grid: [number, number, number] };
    };
    mutable.jobId = "mutated-job-id";
    mutable.kind = "thermal";
    mutable.sourceRevision = revised.revision;
    mutable.document = revised;
    mutable.settings = { changed: true };
    mutable.input = { grid: [99, 99, 99] };

    await expect(handle.completion).resolves.toMatchObject({ event: {
      jobId: "snapshot-mutable-request", state: "verified",
    } });
    expect(handle.jobId).toBe("snapshot-mutable-request");
    expect(observed).toMatchObject({
      jobId: "snapshot-mutable-request", kind: "fea", sourceRevision: document.revision,
      document: { revision: document.revision }, settings: {}, input: { grid: [8, 4, 2] },
    });
  });
});
