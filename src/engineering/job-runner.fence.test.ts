import { describe, expect, it } from "vitest";

import { createArtifactStore, type ArtifactStore } from "./artifact-store";
import { createEngineeringJobRunner } from "./job-runner";
import {
  adapter,
  deferred,
  postWriteBatchStore,
  request,
  resultFor,
  sourceDocument,
  waitFor,
} from "./job-runner-test-fixtures";
import { createSolverRegistry } from "./solver-registry";

describe("engineering job commit fence", () => {
  it("rejects cancellation after a physical write and publishes verified", async () => {
    const document = await sourceDocument();
    const solveRequest = await request(document, "post-write-cancel");
    const result = await resultFor(solveRequest);
    const probe = postWriteBatchStore();
    const registry = createSolverRegistry();
    registry.register(adapter(async () => result));
    const runner = createEngineeringJobRunner({ registry, store: probe.store, currentDocument: () => document });
    const handle = runner.launch(solveRequest);

    await waitFor(probe.written);
    await expect(probe.store.get(result.artifacts[0].record.id)).resolves.toBeInstanceOf(ArrayBuffer);
    expect(runner.cancel(handle.jobId)).toBe(false);
    probe.release();

    await expect(handle.completion).resolves.toMatchObject({ event: { state: "verified" } });
  });

  it("keeps a post-write revision change verified", async () => {
    const document = await sourceDocument();
    const revised = await sourceDocument("Revised link");
    const solveRequest = await request(document, "post-write-revision");
    const result = await resultFor(solveRequest);
    const probe = postWriteBatchStore();
    const registry = createSolverRegistry();
    registry.register(adapter(async () => result));
    let current = document;
    const runner = createEngineeringJobRunner({ registry, store: probe.store, currentDocument: () => current });
    const handle = runner.launch(solveRequest);

    await waitFor(probe.written);
    current = revised;
    probe.release();

    await expect(handle.completion).resolves.toMatchObject({ event: { state: "verified" } });
    await expect(probe.store.get(result.artifacts[0].record.id)).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("does not reclassify a previously accepted fence", async () => {
    const document = await sourceDocument();
    const revised = await sourceDocument("Revised link");
    const solveRequest = await request(document, "rechecked-fence");
    const backing = createArtifactStore();
    const release = deferred<void>();
    let written = false;
    let recheck = true;
    const store: ArtifactStore = {
      get: backing.get,
      delete: backing.delete,
      put: backing.put,
      async commit(entries, guard): Promise<void> {
        await backing.commit(entries, guard);
        written = true;
        await release.promise;
        recheck = guard();
      },
    };
    const registry = createSolverRegistry();
    registry.register(adapter(async (solve) => resultFor(solve)));
    let current = document;
    const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => current });
    const handle = runner.launch(solveRequest);

    await waitFor(() => written);
    current = revised;
    release.resolve(undefined);

    await expect(handle.completion).resolves.toMatchObject({ event: { state: "verified" } });
    expect(recheck).toBe(false);
  });

  it("publishes failed when a store rejects after accepting its fence", async () => {
    const document = await sourceDocument();
    const solveRequest = await request(document, "accepted-store-rejection");
    const backing = createArtifactStore();
    const store: ArtifactStore = {
      get: backing.get,
      delete: backing.delete,
      put: backing.put,
      async commit(_entries, guard): Promise<void> {
        expect(guard()).toBe(true);
        throw Object.assign(new Error("durable commit rejected"), { code: "store-failed" });
      },
    };
    const registry = createSolverRegistry();
    registry.register(adapter(async (solve) => resultFor(solve)));
    const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => document });

    await expect(runner.launch(solveRequest).completion).resolves.toMatchObject({ event: {
      state: "failed", error: { code: "internal-error" },
    } });
  });

  it("keeps the default-store microtask cancellation on the verified side of the fence", async () => {
    const document = await sourceDocument();
    const solveRequest = await request(document, "default-fence-cancel");
    const result = await resultFor(solveRequest);
    const registry = createSolverRegistry();
    registry.register(adapter(async () => result));
    const cancellations: boolean[] = [];
    let reads = 0;
    let runner!: ReturnType<typeof createEngineeringJobRunner>;
    runner = createEngineeringJobRunner({
      registry,
      store: createArtifactStore(),
      currentDocument: () => {
        reads += 1;
        if (reads === 6) queueMicrotask(() => cancellations.push(runner.cancel(solveRequest.jobId)));
        return document;
      },
    });

    const handle = runner.launch(solveRequest);

    await expect(handle.completion).resolves.toMatchObject({ event: { state: "verified" } });
    expect(cancellations).toEqual([false]);
  });

  it("keeps the default-store microtask revision change on the verified side of the fence", async () => {
    const document = await sourceDocument();
    const revised = await sourceDocument("Revised link");
    const solveRequest = await request(document, "default-fence-revision");
    const result = await resultFor(solveRequest);
    const registry = createSolverRegistry();
    registry.register(adapter(async () => result));
    let current = document;
    let reads = 0;
    const runner = createEngineeringJobRunner({
      registry,
      store: createArtifactStore(),
      currentDocument: () => {
        reads += 1;
        if (reads === 6) queueMicrotask(() => { current = revised; });
        return current;
      },
    });

    await expect(runner.launch(solveRequest).completion).resolves.toMatchObject({ event: { state: "verified" } });
    expect(current).toBe(revised);
  });
});
