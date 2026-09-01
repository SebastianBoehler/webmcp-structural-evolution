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
  cadAdapter,
  cadResult,
  human,
  immediateAdapter,
  rename,
  solveResult,
  structuralPlanner,
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
    capability: { kind: "fea" }, supports: () => ({ supported: true }),
    async run(request) { solveRequest = request; solverStarted(); return solverGate; },
  });
  const service = createEngineeringWorkspaceService(await workspaceOptions({ store, registry }));
  const root = service.inspect().document;
  const launched = await service.launchStudy({ studyId: "link-static", expectedRevision: root.revision });
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
  registry.register(immediateAdapter());
  const service = createEngineeringWorkspaceService(await workspaceOptions({ store, registry }));
  const root = service.inspect().document;
  const launched = await service.launchStudy({ studyId: "link-static", expectedRevision: root.revision });
  await written;
  let applySettled = false;
  const applying = service.apply(rename(root, "post-write-apply", "Post-write apply"))
    .then((receipt) => { applySettled = true; return receipt; });
  await new Promise<void>((resolve) => setTimeout(resolve, 20));

  expect(applySettled).toBe(false);
  release();
  await waitFor(() => service.inspectJob(launched.jobId).event.state === "verified");
  await expect(applying).resolves.toMatchObject({ outcome: { status: "succeeded" } });
  const field = service.inspect().artifacts.find(({ kind }) => kind === "field");
  expect(field).toBeDefined();
  await expect(store.get(field!.id)).resolves.toBeDefined();
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

it("compares retained verified ancestor and current results with matching contracts", async () => {
  const service: EngineeringWorkspaceService = createEngineeringWorkspaceService(await workspaceOptions());
  const root = service.inspect().document;
  const first = await service.launchStudy({ studyId: "link-static", expectedRevision: root.revision });
  await waitFor(() => service.inspectJob(first.jobId).event.state === "verified");
  await service.apply(defineUnrelatedParameter(root, "comparison-head"));
  const current = service.inspect().document;
  const second = await service.launchStudy({ studyId: "link-static", expectedRevision: current.revision });
  await waitFor(() => service.inspectJob(second.jobId).event.state === "verified");
  const fields = service.inspect().artifacts.filter(({ kind }) => kind === "field");
  const ancestor = fields.find(({ sourceRevision }) => sourceRevision === root.revision)!;
  const latest = fields.find(({ sourceRevision }) => sourceRevision === current.revision)!;

  await expect(service.compareResults(ancestor.id, latest.id)).resolves.toMatchObject({
    leftSourceRevision: root.revision,
    rightSourceRevision: current.revision,
    comparable: true,
  });
});
