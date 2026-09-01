import { expect, it, vi } from "vitest";

import type { ArtifactRecord } from "../cad/artifact-contract";
import type { DesignDocument } from "../cad/document-schema";
import { createArtifactStore, type ArtifactStore } from "../engineering/artifact-store";
import { createSolverRegistry } from "../engineering/solver-registry";
import {
  createEngineeringWorkspaceService,
} from "./engineering-workspace-service";
import {
  human, immediateAdapter, PRODUCTION_TEST_STUDY_ID, productionWorkspaceOptions,
} from "./workspace-test-fixtures";

const rename = (document: DesignDocument) => ({
  id: "invalidate-comparison", expectedRevision: document.revision, actor: human, preconditions: [],
  commands: [{ id: "rename-model", type: "rename-document" as const, label: "Changed exact cobot" }],
});

it("rechecks comparison eligibility after durable reads before returning", async () => {
  const backing = createArtifactStore();
  let readCount = 0;
  let entered!: () => void;
  let release!: () => void;
  const readsEntered = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store: ArtifactStore = {
    put: backing.put, commit: backing.commit, delete: backing.delete,
    async get(id) {
      const payload = await backing.get(id);
      if (payload && payload instanceof Uint8Array && payload[0]! >= 20) {
        readCount += 1;
        if (readCount === 2) entered();
        await gate;
      }
      return payload;
    },
  };
  let resultValue = 20;
  const registry = createSolverRegistry();
  registry.register(immediateAdapter(false, [], () => ++resultValue, "thermal"));
  const service = createEngineeringWorkspaceService(await productionWorkspaceOptions({ store, registry }));
  const revision = service.inspect().document.revision;
  const firstJob = await service.launchStudy({
    studyId: PRODUCTION_TEST_STUDY_ID, expectedRevision: revision,
  });
  const secondJob = await service.launchStudy({
    studyId: PRODUCTION_TEST_STUDY_ID, expectedRevision: revision,
  });
  await Promise.all([firstJob.jobId, secondJob.jobId].map(async (jobId) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (service.inspectJob(jobId).event.state === "verified") return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("Production comparison job did not verify");
  }));
  const fields = service.inspect().artifacts.filter(({ kind }) => kind === "field");

  const comparing = service.compareResults(fields[0]!.id, fields[1]!.id);
  await readsEntered;
  await service.apply(rename(service.inspect().document));
  release();

  await expect(comparing).rejects.toThrow(/active|eligible|stale|current/i);
});

it("reserves a duplicate job ID before publishing any new artifact event", async () => {
  const store = createArtifactStore();
  const registry = createSolverRegistry();
  registry.register(immediateAdapter(false, [], () => 12, "thermal"));
  const service = createEngineeringWorkspaceService(await productionWorkspaceOptions({ store, registry }));
  const revision = service.inspect().document.revision;
  const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000012");
  const events: Array<readonly ArtifactRecord[]> = [];
  service.subscribe((event) => {
    if (event.type === "artifacts-changed") {
      events.push(service.inspect().artifacts.filter(({ id }) => event.artifactIds.includes(id)));
    }
  });
  const launched = await service.launchStudy({
    studyId: PRODUCTION_TEST_STUDY_ID, expectedRevision: revision,
  });
  for (let attempt = 0; attempt < 80 && service.inspectJob(launched.jobId).event.state !== "verified"; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  expect(service.inspectJob(launched.jobId).event.state).toBe("verified");
  const eventCount = events.length;

  await expect(service.launchStudy({
    studyId: PRODUCTION_TEST_STUDY_ID, expectedRevision: revision,
  })).rejects.toThrow(/job.*already|duplicate/i);

  const derived = service.inspect().artifacts.find(({ kind }) => kind === "sdf")!;
  await expect(store.get(derived.id)).resolves.toBeDefined();
  expect(events).toHaveLength(eventCount);
  uuid.mockRestore();
});
