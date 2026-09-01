import { expect, it } from "vitest";

import type { ArtifactRecord } from "../cad/artifact-contract";
import type { DesignDocument } from "../cad/document-schema";
import { createArtifactStore, type ArtifactStore } from "../engineering/artifact-store";
import {
  exactCobotPlan, serviceForPlans, thermalResult, waitForJob,
} from "./workspace-lineage-test-support";
import { human } from "./workspace-test-fixtures";

const rename = (document: DesignDocument) => ({
  id: "invalidate-comparison", expectedRevision: document.revision, actor: human, preconditions: [],
  commands: [{ id: "rename-model", type: "rename-document" as const, label: "Changed exact cobot" }],
});

it("rechecks comparison eligibility after durable reads before returning", async () => {
  const first = await exactCobotPlan("comparison-one");
  const second = await exactCobotPlan("comparison-two");
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
  const { service } = await serviceForPlans(
    [first, second],
    (request) => thermalResult(request, request.jobId.endsWith("one") ? 21 : 22),
    store,
  );
  const firstJob = await service.launchStudy({
    studyId: "se6-upper-arm-thermal", expectedRevision: first.document.revision,
  });
  const secondJob = await service.launchStudy({
    studyId: "se6-upper-arm-thermal", expectedRevision: first.document.revision,
  });
  await waitForJob(service, firstJob.jobId, "verified");
  await waitForJob(service, secondJob.jobId, "verified");
  const fields = service.inspect().artifacts.filter(({ kind }) => kind === "field");

  const comparing = service.compareResults(fields[0]!.id, fields[1]!.id);
  await readsEntered;
  await service.apply(rename(service.inspect().document));
  release();

  await expect(comparing).rejects.toThrow(/active|eligible|stale|current/i);
});

it("reserves a duplicate job ID before committing a new compiler input or publishing an artifact event", async () => {
  const first = await exactCobotPlan("duplicate-job", 1);
  const second = await exactCobotPlan("duplicate-job", 2);
  const { service, store } = await serviceForPlans(
    [first, second], (request) => thermalResult(request, 12),
  );
  const events: Array<readonly ArtifactRecord[]> = [];
  service.subscribe((event) => {
    if (event.type === "artifacts-changed") {
      events.push(service.inspect().artifacts.filter(({ id }) => event.artifactIds.includes(id)));
    }
  });
  const launched = await service.launchStudy({
    studyId: "se6-upper-arm-thermal", expectedRevision: first.document.revision,
  });
  await waitForJob(service, launched.jobId, "verified");
  const eventCount = events.length;

  await expect(service.launchStudy({
    studyId: "se6-upper-arm-thermal", expectedRevision: first.document.revision,
  })).rejects.toThrow(/job.*already|duplicate/i);

  expect(service.inspect().artifacts.some(({ id }) => id === second.derived.record.id)).toBe(false);
  await expect(store.get(second.derived.record.id)).resolves.toBeUndefined();
  expect(events).toHaveLength(eventCount);
});
