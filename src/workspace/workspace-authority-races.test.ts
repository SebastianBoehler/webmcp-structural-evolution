import { expect, it, vi } from "vitest";

import type { DesignDocument } from "../cad/document-schema";
import { createArtifactStore, type ArtifactStore } from "../engineering/artifact-store";
import { createSolverRegistry } from "../engineering/solver-registry";
import type { EngineeringSolveRequest, SolverRunResult } from "../engineering/solver-adapter";
import {
  createEngineeringWorkspaceService,
  type EngineeringWorkspaceService,
} from "./engineering-workspace-service";
import {
  human,
  immediateAdapter,
  PRODUCTION_TEST_STUDY_ID,
  productionWorkspaceOptions,
  rename,
  solveResult,
  workspaceOptions,
} from "./workspace-test-fixtures";

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for workspace race state");
};

const defineUnrelatedParameter = (document: DesignDocument, id: string) => ({
  id, expectedRevision: document.revision, actor: human, preconditions: [],
  commands: [{ id: `${id}-parameter`, type: "define-parameter" as const, parameter: {
    id: `${id}-length`, label: "Unrelated length",
    value: { kind: "length" as const, value: { value: 1, unit: "m" as const } },
  } }],
});

it("does not lose solver metadata finalized while a CAD commit is awaiting storage", async () => {
  const backing = createArtifactStore();
  let entered!: () => void;
  let release!: () => void;
  const cadCommitEntered = new Promise<void>((resolve) => { entered = resolve; });
  const cadGate = new Promise<void>((resolve) => { release = resolve; });
  const store: ArtifactStore = {
    get: backing.get, delete: backing.delete, put: backing.put,
    async commit(entries, guard) {
      if (entries.some(({ record }) => record.kind === "export")) {
        entered();
        await cadGate;
      }
      await backing.commit(entries, guard);
    },
  };
  let solverStarted!: () => void;
  let releaseSolver!: (result: SolverRunResult<{ readonly completed: true }>) => void;
  const started = new Promise<void>((resolve) => { solverStarted = resolve; });
  const solverGate = new Promise<SolverRunResult<{ readonly completed: true }>>(
    (resolve) => { releaseSolver = resolve; },
  );
  let solveRequest!: EngineeringSolveRequest<unknown>;
  const registry = createSolverRegistry();
  registry.register({
    capability: { kind: "thermal" }, supports: () => ({ supported: true }),
    async run(request) { solveRequest = request; solverStarted(); return solverGate; },
  });
  const service = createEngineeringWorkspaceService(await productionWorkspaceOptions({ store, registry }));
  const root = service.inspect().document;
  const launched = await service.launchStudy({ studyId: PRODUCTION_TEST_STUDY_ID, expectedRevision: root.revision });
  await started;
  const rebuilding = service.rebuild({
    requestId: "blocked-cad", expectedRevision: root.revision, outputs: ["step"], settings: {},
  });
  await cadCommitEntered;
  releaseSolver(await solveResult(solveRequest, 8));
  setTimeout(release, 15);

  await rebuilding;
  await waitFor(() => service.inspectJob(launched.jobId).event.state === "verified");
  expect(service.inspect().artifacts.map(({ kind }) => kind)).toEqual(
    expect.arrayContaining(["export", "field"]),
  );
});

it("orders a commit-accepted solver finalization before a competing apply", async () => {
  const backing = createArtifactStore();
  let markWritten!: () => void;
  let release!: () => void;
  const written = new Promise<void>((resolve) => { markWritten = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store: ArtifactStore = {
    get: backing.get, delete: backing.delete, put: backing.put,
    async commit(entries, guard) {
      await backing.commit(entries, guard);
      if (entries.some(({ record }) => record.kind === "field")) {
        markWritten();
        await gate;
      }
    },
  };
  const registry = createSolverRegistry();
  registry.register(immediateAdapter(false, [], undefined, "thermal"));
  const service = createEngineeringWorkspaceService(await productionWorkspaceOptions({ store, registry }));
  const root = service.inspect().document;
  const launched = await service.launchStudy({ studyId: PRODUCTION_TEST_STUDY_ID, expectedRevision: root.revision });
  await written;
  let applySettled = false;
  const applying = service.apply(rename(root, "post-write-apply", "Post-write apply"))
    .then((receipt) => { applySettled = true; return receipt; });
  await new Promise<void>((resolve) => setTimeout(resolve, 20));

  expect(applySettled).toBe(false);
  release();
  await waitFor(() => service.inspectJob(launched.jobId).event.state === "verified");
  await expect(applying).resolves.toMatchObject({ outcome: { status: "succeeded" } });
  expect(service.inspect().artifacts.find(({ kind }) => kind === "field")).toBeUndefined();
});

it("does not advance hidden session state when artifact invalidation fails", async () => {
  const backing = createArtifactStore();
  let failDelete = true;
  const store: ArtifactStore = {
    get: backing.get, put: backing.put, commit: backing.commit,
    async delete(ids) {
      if (failDelete) { failDelete = false; throw new Error("durable invalidation failed"); }
      await backing.delete(ids);
    },
  };
  const service = createEngineeringWorkspaceService(await workspaceOptions({ store }));
  const root = service.inspect().document;
  await service.rebuild({
    requestId: "apply-rollback", expectedRevision: root.revision, outputs: ["step"], settings: {},
  });
  const before = service.inspect();
  const events = vi.fn();
  service.subscribe(events);

  await expect(service.apply(rename(root, "failed-invalidation", "Must not commit")))
    .rejects.toThrow(/invalidation failed/i);
  expect(service.inspect()).toBe(before);
  expect(events).not.toHaveBeenCalled();

  await expect(service.apply(rename(root, "retry-invalidation", "Retry commits")))
    .resolves.toMatchObject({ outcome: { status: "succeeded" } });
  expect(service.inspect().document.label).toBe("Retry commits");
});

it("retains an ancestor result but rejects untrusted rederivation at the new revision", async () => {
  const service: EngineeringWorkspaceService = createEngineeringWorkspaceService(await productionWorkspaceOptions());
  const root = service.inspect().document;
  const first = await service.launchStudy({ studyId: PRODUCTION_TEST_STUDY_ID, expectedRevision: root.revision });
  await waitFor(() => service.inspectJob(first.jobId).event.state === "verified");
  await service.apply(defineUnrelatedParameter(root, "comparison-head"));
  const current = service.inspect().document;
  await expect(service.launchStudy({ studyId: PRODUCTION_TEST_STUDY_ID, expectedRevision: current.revision }))
    .rejects.toThrow(/component planner intent/i);
  expect(service.inspect().artifacts.filter(({ kind }) => kind === "field"))
    .toEqual([expect.objectContaining({ sourceRevision: root.revision })]);
});
