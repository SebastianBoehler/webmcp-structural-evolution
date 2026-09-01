import { describe, expect, it, vi } from "vitest";

import { createDesignSession } from "../cad/design-session";
import { defineArtifactRecord, type ArtifactRecord } from "../cad/artifact-contract";
import { defineEngineeringSolveRequest } from "../cad/engineering-job-contract";
import { createArtifactStore, digestArtifactPayload } from "../engineering/artifact-store";
import { sourceDocument } from "../engineering/job-runner-test-fixtures";
import { createSolverRegistry } from "../engineering/solver-registry";
import type { SolverRunResult } from "../engineering/solver-adapter";
import {
  createEngineeringWorkspaceService,
  type EngineeringWorkspaceService,
} from "./engineering-workspace-service";
import {
  agent,
  cadAdapter,
  cadResult,
  gatedAdapter,
  human,
  immediateAdapter,
  rename,
  solveResult,
  structuralPlanner,
  workspaceOptions,
} from "./workspace-test-fixtures";

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for workspace state");
};

const currentDocument = (service: EngineeringWorkspaceService) => service.inspect().document;
const approval = (
  artifact: ReturnType<EngineeringWorkspaceService["inspect"]>["artifacts"][number],
  headRevision: string,
  nonce = "export-once",
) => ({
  operation: "export-artifact" as const,
  artifactId: artifact.id,
  headRevision,
  sourceRevision: artifact.sourceRevision,
  contentDigest: artifact.contentDigest,
  mediaType: artifact.mediaType,
  issuedBy: human,
  nonce,
});

describe("engineering workspace authority", () => {
  it("returns one frozen inspection identity until the next workspace event", async () => {
    const service = createEngineeringWorkspaceService(await workspaceOptions());
    const before = service.inspect();

    expect(Object.isFrozen(before)).toBe(true);
    expect(service.inspect()).toBe(before);
    await service.apply(rename(before.document, "snapshot-change", "Snapshot change"));

    const after = service.inspect();
    expect(after).not.toBe(before);
    expect(service.inspect()).toBe(after);
  });

  it("serializes simultaneous human and agent apply with one CAS winner and leaves acceptance unchanged", async () => {
    const service = createEngineeringWorkspaceService(await workspaceOptions());
    const root = currentDocument(service);
    const events: string[] = [];
    service.subscribe((event) => events.push(event.type));

    const [first, second] = await Promise.all([
      service.apply(rename(root, "human-edit", "Human edit", human)),
      service.apply(rename(root, "agent-edit", "Agent edit", agent)),
    ]);

    expect([first.outcome.status, second.outcome.status].sort()).toEqual(["failed", "succeeded"]);
    expect(service.inspect()).toMatchObject({
      document: { label: "Human edit" },
      acceptedRevision: root.revision,
    });
    expect(events).toEqual(["transaction-recorded", "transaction-recorded"]);
    expect(service.inspect()).toMatchObject({ receiptCount: 2 });
  });

  it("rejects stale rebuild and study launch before invoking CAD or a planner", async () => {
    const cadEvaluate = vi.fn();
    const planner = vi.fn(structuralPlanner());
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      createCadAdapter: () => cadAdapter(cadEvaluate),
      planners: { "structural-linear": planner },
    }));
    const root = currentDocument(service);
    await service.apply(rename(root, "advance", "Advanced"));

    await expect(service.rebuild({
      requestId: "stale-rebuild", expectedRevision: root.revision,
      outputs: ["step"], settings: {},
    })).rejects.toMatchObject({ code: "stale-revision" });
    await expect(service.launchStudy({
      studyId: "link-static", expectedRevision: root.revision,
    })).rejects.toMatchObject({ code: "stale-revision" });
    expect(cadEvaluate).not.toHaveBeenCalled();
    expect(planner).not.toHaveBeenCalled();
  });

  it("rejects launch when the revision changes during solve-request canonicalization", async () => {
    const registry = createSolverRegistry();
    const adapter = immediateAdapter();
    const run = vi.spyOn(adapter, "run");
    registry.register(adapter);
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      registry,
      planners: { "structural-linear": structuralPlanner() },
    }));
    const root = currentDocument(service);
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let entered!: () => void;
    let release!: () => void;
    const enteredDigest = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (algorithm, data) => {
      entered();
      await gate;
      return originalDigest(algorithm, data);
    });

    const launching = service.launchStudy({ studyId: "link-static", expectedRevision: root.revision });
    await enteredDigest;
    await service.apply(rename(root, "launch-race", "Launch race"));
    release();

    await expect(launching).rejects.toMatchObject({ code: "stale-revision" });
    expect(run).not.toHaveBeenCalled();
    digest.mockRestore();
  });

  it("reports a rebuild as stale when apply wins before its atomic payload commit", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = createArtifactStore();
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      store,
      createCadAdapter: () => cadAdapter(async (request, _signal, emit) => {
        await gate;
        emit(await cadResult(request));
      }),
    }));
    const root = currentDocument(service);
    const rebuilding = service.rebuild({
      requestId: "losing-rebuild", expectedRevision: root.revision, outputs: ["step"], settings: {},
    });
    await Promise.resolve();
    await service.apply(rename(root, "winning-apply", "Apply wins"));
    release();

    await expect(rebuilding).rejects.toMatchObject({ code: "stale-revision" });
    expect(service.inspect().artifacts).toHaveLength(0);
  });

  it("serializes CAD payload commit and attachment with a competing apply mutation", async () => {
    const backing = createArtifactStore();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enteredCommit = new Promise<void>((resolve) => { entered = resolve; });
    const store = {
      get: backing.get, delete: backing.delete, put: backing.put,
      async commit(entries: Parameters<typeof backing.commit>[0], guard: () => boolean) {
        entered();
        await gate;
        return backing.commit(entries, guard);
      },
    };
    let rebuiltArtifactId = "";
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      store,
      createCadAdapter: () => cadAdapter(async (request, _signal, emit) => {
        const event = await cadResult(request);
        rebuiltArtifactId = event.results[0] && "artifact" in event.results[0]
          ? event.results[0].artifact.id : "";
        emit(event);
      }),
    }));
    const root = currentDocument(service);
    const rebuilding = service.rebuild({
      requestId: "serialized-rebuild", expectedRevision: root.revision, outputs: ["step"], settings: {},
    });
    await enteredCommit;
    let applySettled = false;
    const applying = service.apply(rename(root, "queued-apply", "Queued apply"))
      .then((receipt) => { applySettled = true; return receipt; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(applySettled).toBe(false);
    release();
    await expect(rebuilding).resolves.toMatchObject({ outcome: { status: "succeeded" } });
    await expect(applying).resolves.toMatchObject({ outcome: { status: "succeeded" } });
    expect(service.inspect().artifacts).toHaveLength(0);
    await expect(store.get(rebuiltArtifactId)).resolves.toBeUndefined();
  });

  it("dry-runs in a fresh adapter and ephemeral store without session, payload, or event mutation", async () => {
    const durableStore = createArtifactStore();
    const dryStore = createArtifactStore();
    const dryPut = vi.spyOn(dryStore, "commit");
    const durablePut = vi.spyOn(durableStore, "commit");
    const dispose = vi.fn();
    let adapters = 0;
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      store: durableStore,
      createEphemeralStore: () => dryStore,
      createCadAdapter: () => {
        adapters += 1;
        return cadAdapter(async (request, _signal, emit) => emit(await cadResult(request)), dispose);
      },
    }));
    const root = currentDocument(service);
    const events = vi.fn();
    service.subscribe(events);

    const preview = await service.dryRun({
      transaction: rename(root, "preview", "Preview only"),
      outputs: ["step"],
      settings: {},
    });

    expect(preview).toMatchObject({ sourceRevision: root.revision, changed: true, outputs: ["step"] });
    expect(preview.previewRevision).not.toBe(root.revision);
    expect(service.inspect()).toMatchObject({ document: { label: root.label }, artifactCount: 2 });
    expect(adapters).toBe(1);
    expect(dryPut).toHaveBeenCalledOnce();
    expect(durablePut).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each(["error", "abort"] as const)("disposes a dry-run lease exactly once on %s", async (mode) => {
    const dispose = vi.fn();
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      createCadAdapter: () => cadAdapter(async (_request, signal) => {
        markEntered();
        if (mode === "error") throw new Error("kernel failed");
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")), { once: true }));
      }, dispose),
    }));
    const root = currentDocument(service);
    const controller = new AbortController();
    const running = service.dryRun({
      transaction: rename(root, `preview-${mode}`, `Preview ${mode}`), outputs: ["step"], settings: {},
    }, controller.signal);
    await entered;
    if (mode === "abort") controller.abort();

    await expect(running).rejects.toThrow(mode === "error" ? /kernel failed/i : /abort/i);
    expect(dispose).toHaveBeenCalledOnce();
    expect(service.inspect()).toMatchObject({ document: { label: root.label }, artifactCount: 2 });
  });

  it("invalidates active metadata and payloads and cancels old-revision jobs before quarantining late output", async () => {
    const store = createArtifactStore();
    const registry = createSolverRegistry();
    const pending = gatedAdapter();
    registry.register(pending.adapter);
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      store, registry, planners: { "structural-linear": structuralPlanner() },
    }));
    const root = currentDocument(service);
    await service.rebuild({
      requestId: "current-step", expectedRevision: root.revision, outputs: ["step"], settings: {},
    });
    const cadArtifact = service.inspect().artifacts[0]!;
    const { jobId } = await service.launchStudy({ studyId: "link-static", expectedRevision: root.revision });
    await pending.gate.started;

    await service.apply(rename(root, "invalidate", "Changed design"));

    expect(pending.signal()?.aborted).toBe(true);
    expect(service.inspectJob(jobId).event.state).toBe("cancelled");
    expect(service.inspect().artifacts).not.toContainEqual(cadArtifact);
    await expect(store.get(cadArtifact.id)).resolves.toBeUndefined();
    const latePlan = await structuralPlanner()({
      document: root,
      study: root.studies[0] as never,
      artifacts: [],
    });
    const late = await solveResult(latePlan.request, 9);
    pending.gate.release(late);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(service.inspectJob(jobId).event.state).toBe("cancelled");
    expect(service.inspect().artifacts.some(({ id }) => id === late.artifacts[0].record.id)).toBe(false);
    await expect(store.get(late.artifacts[0].record.id)).resolves.toBeUndefined();
  });

  it("selects study execution by typed kind and passes a complete revision-bound request, never a fixture ID", async () => {
    const calls: Array<{ readonly kind: string; readonly studyId: string }> = [];
    const seen: Parameters<ReturnType<typeof immediateAdapter>["run"]>[0][] = [];
    const registry = createSolverRegistry();
    registry.register(immediateAdapter(false, seen));
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      registry, planners: { "structural-linear": structuralPlanner(calls) },
    }));
    const root = currentDocument(service);

    const { jobId } = await service.launchStudy({ studyId: "link-static", expectedRevision: root.revision });
    await waitFor(() => service.inspectJob(jobId).event.state === "verified");

    expect(calls).toEqual([{ kind: "structural-linear", studyId: "link-static" }]);
    expect(seen[0]).toMatchObject({
      kind: "fea", studyId: "link-static", sourceRevision: root.revision,
      document: { revision: root.revision }, input: {
        semanticMeshArtifactId: expect.any(String), voxelArtifactId: expect.any(String),
      },
    });
    expect(JSON.stringify(seen[0])).not.toMatch(/reference-drone|se6-cobot|fixture/i);
  });

  it("commits planner-produced exact input payloads and attaches their bound records before launch", async () => {
    const store = createArtifactStore();
    const registry = createSolverRegistry();
    let service!: EngineeringWorkspaceService;
    let observedBeforeRun = false;
    let inputRecord: ArtifactRecord | undefined;
    registry.register({
      capability: { kind: "fea" }, supports: () => ({ supported: true }),
      async run(request) {
        inputRecord = request.inputArtifacts.find(({ kind }) => kind === "solver-mesh");
        observedBeforeRun = !!inputRecord
          && service.inspect().artifacts.some(({ id }) => id === inputRecord!.id)
          && (await store.get(inputRecord.id)) !== undefined;
        return solveResult(request, 1);
      },
    });
    service = createEngineeringWorkspaceService(await workspaceOptions({ store, registry }));
    const root = service.inspect().document;

    const { jobId } = await service.launchStudy({ studyId: "link-static", expectedRevision: root.revision });
    await waitFor(() => service.inspectJob(jobId).event.state === "verified");

    expect(inputRecord).toBeDefined();
    expect(service.inspect().artifacts).toContainEqual(inputRecord);
    await expect(store.get(inputRecord!.id)).resolves.toBeDefined();
    expect(observedBeforeRun).toBe(true);
  });

  it("rejects solve inputs outside the active exact model and compiler batch", async () => {
    const root = await sourceDocument();
    const payload = Uint8Array.of(37);
    const detached = await defineArtifactRecord({
      kind: "solver-mesh", sourceRevision: root.revision,
      producer: { name: "detached-model", version: "1.0.0" },
      settingsDigest: "7".repeat(64), contentDigest: await digestArtifactPayload(payload),
      units: "m", mediaType: "application/vnd.engineering.solver-mesh",
      dependencies: [
        { kind: "entity", reference: "body:link-body" },
        { kind: "entity", reference: "feature:link-feature" },
        { kind: "entity", reference: "study:link-static" },
      ],
    });
    const request = await defineEngineeringSolveRequest({
      jobId: "detached-model-job", kind: "fea", sourceRevision: root.revision,
      inputArtifacts: [detached], settings: {}, studyId: "link-static", input: {}, document: root,
    });
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      session: createDesignSession(root),
      planners: { "structural-linear": async () => ({ request, inputs: [] }) },
    }));

    await expect(service.launchStudy({
      studyId: "link-static", expectedRevision: root.revision,
    })).rejects.toThrow(/active exact model|compiled input/i);
  });

  it("leaves no planned payload or metadata when compilation becomes stale", async () => {
    const root = await sourceDocument();
    const payload = Uint8Array.of(41);
    const inputRecord = await defineArtifactRecord({
      kind: "solver-mesh", sourceRevision: root.revision,
      producer: { name: "deferred-compiler", version: "1.0.0" },
      settingsDigest: "4".repeat(64), contentDigest: await digestArtifactPayload(payload),
      units: "m", mediaType: "application/vnd.engineering.solver-mesh",
      dependencies: [{ kind: "entity", reference: "study:link-static" }],
    });
    const solve = await defineEngineeringSolveRequest({
      jobId: "stale-planned-input", kind: "fea", sourceRevision: root.revision,
      inputArtifacts: [inputRecord], settings: {}, studyId: "link-static", input: {}, document: root,
    });
    let entered!: () => void;
    let release!: () => void;
    const compiling = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = createArtifactStore();
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      session: createDesignSession(root), store,
      planners: { "structural-linear": async () => {
        entered();
        await gate;
        return { request: solve, inputs: [{ record: inputRecord, payload }] } as never;
      } },
    }));

    const launch = service.launchStudy({ studyId: "link-static", expectedRevision: root.revision });
    await compiling;
    await service.apply(rename(root, "stale-compiler", "Stale compiler"));
    release();

    await expect(launch).rejects.toMatchObject({ code: "stale-revision" });
    await expect(store.get(inputRecord.id)).resolves.toBeUndefined();
    expect(service.inspect().artifacts).not.toContainEqual(inputRecord);
  });

  it("rejects a compiled payload whose record is not bound into the solve request", async () => {
    const root = await sourceDocument();
    const payload = Uint8Array.of(51);
    const unbound = await defineArtifactRecord({
      kind: "solver-mesh", sourceRevision: root.revision,
      producer: { name: "unbound-compiler", version: "1.0.0" },
      settingsDigest: "5".repeat(64), contentDigest: await digestArtifactPayload(payload),
      units: "m", mediaType: "application/vnd.engineering.solver-mesh",
      dependencies: [{ kind: "entity", reference: "study:link-static" }],
    });
    const solve = await defineEngineeringSolveRequest({
      jobId: "unbound-planned-input", kind: "fea", sourceRevision: root.revision,
      inputArtifacts: [], settings: {}, studyId: "link-static", input: {}, document: root,
    });
    const store = createArtifactStore();
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      session: createDesignSession(root), store,
      planners: { "structural-linear": async () => ({
        request: solve, inputs: [{ record: unbound, payload }],
      }) as never },
    }));

    await expect(service.launchStudy({
      studyId: "link-static", expectedRevision: root.revision,
    })).rejects.toThrow(/input|bound|request/i);
    await expect(store.get(unbound.id)).resolves.toBeUndefined();
    expect(service.inspect().artifacts).not.toContainEqual(unbound);
  });

  it("compares only distinct current verified comparable results", async () => {
    const service = createEngineeringWorkspaceService(await workspaceOptions());
    const revision = currentDocument(service).revision;
    const first = await service.launchStudy({ studyId: "link-static", expectedRevision: revision });
    const second = await service.launchStudy({ studyId: "link-static", expectedRevision: revision });
    await waitFor(() => service.inspectJob(first.jobId).event.state === "verified"
      && service.inspectJob(second.jobId).event.state === "verified");
    const fields = service.inspect().artifacts.filter(({ kind }) => kind === "field");

    await expect(service.compareResults(fields[0]!.id, fields[1]!.id)).resolves.toMatchObject({
      leftSourceRevision: revision, rightSourceRevision: revision, comparable: true,
      leftArtifactId: fields[0]!.id, rightArtifactId: fields[1]!.id,
    });
    await expect(service.compareResults(fields[0]!.id, fields[0]!.id)).rejects.toThrow(/distinct/i);
  });

  it("exports only a stored active export artifact after injected one-use approval verification and returns an owned Blob", async () => {
    const verifyExportApproval = vi.fn(async (candidate: { readonly nonce: string }) =>
      candidate.nonce === "export-once");
    const service = createEngineeringWorkspaceService(await workspaceOptions({ verifyExportApproval }));
    const revision = currentDocument(service).revision;
    await service.rebuild({ requestId: "export", expectedRevision: revision, outputs: ["step"], settings: {} });
    const artifact = service.inspect().artifacts.find(({ kind }) => kind === "export")!;

    await expect(service.exportArtifact(artifact.id, {
      ...approval(artifact, revision), issuedBy: agent,
    } as never)).rejects.toThrow(/human/i);
    const blob = await service.exportArtifact(artifact.id, approval(artifact, revision));
    expect(blob).toBeInstanceOf(Blob);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([7]);
    await expect(service.exportArtifact(artifact.id, approval(artifact, revision))).rejects.toThrow(/nonce|used/i);
    expect(verifyExportApproval).toHaveBeenCalledOnce();
    const activeHead = currentDocument(service);
    await expect(service.exportArtifact(
      artifact.id,
      approval(artifact, activeHead.revision, "unverified"),
    )).rejects.toThrow(/approval|verified/i);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([7]);
  });

  it("rechecks head-bound exact CAD export approval while retaining eligible ancestor artifacts", async () => {
    let entered!: () => void;
    let release!: () => void;
    const enteredVerification = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      verifyExportApproval: async () => { entered(); await gate; return true; },
    }));
    const root = currentDocument(service);
    await service.rebuild({ requestId: "retained-exact", expectedRevision: root.revision,
      outputs: ["step"], settings: {} });
    const record = service.inspect().artifacts.find(({ kind }) => kind === "export")!;
    const exporting = service.exportArtifact(record.id, approval(record, root.revision, "retained-nonce"));
    await enteredVerification;
    await service.apply({
      id: "retained-export", expectedRevision: root.revision, actor: human, preconditions: [],
      commands: [{ id: "define-export-note", type: "define-parameter", parameter: {
        id: "export-note", label: "Unrelated export note",
        value: { kind: "length", value: { value: 1, unit: "m" } },
      } }],
    });
    expect(service.inspect().artifacts).toContainEqual(record);
    release();

    await expect(exporting).rejects.toThrow(/approval|head|revision|stale/i);
    const blob = await service.exportArtifact(
      record.id, approval(record, currentDocument(service).revision, "retained-nonce"),
    );
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([7]);
  });

  it("rejects a solver-produced export label without service-owned exact CAD bytes", async () => {
    const root = await sourceDocument();
    const payload = Uint8Array.of(99);
    const record = await defineArtifactRecord({
      kind: "export", sourceRevision: root.revision,
      producer: { name: "topology-solver", version: "1.0.0" },
      settingsDigest: "9".repeat(64), contentDigest: await digestArtifactPayload(payload),
      units: "m", mediaType: "model/step",
      dependencies: [{ kind: "entity", reference: "study:link-static" }],
    });
    const store = createArtifactStore();
    await store.put(record, payload);
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      session: createDesignSession(root, [record]), store,
      verifyExportApproval: async () => true,
    }));

    await expect(service.exportArtifact(
      record.id, approval(record, root.revision, "solver-export"),
    )).rejects.toThrow(/exact cad|raw export|provenance/i);
  });

  it("deduplicates repeated verified artifact IDs before attaching metadata", async () => {
    const registry = createSolverRegistry();
    registry.register(immediateAdapter(false, [], () => 4));
    const service = createEngineeringWorkspaceService(await workspaceOptions({ registry }));
    const revision = currentDocument(service).revision;

    const first = await service.launchStudy({ studyId: "link-static", expectedRevision: revision });
    const second = await service.launchStudy({ studyId: "link-static", expectedRevision: revision });
    await waitFor(() => service.inspectJob(first.jobId).event.state === "verified"
      && service.inspectJob(second.jobId).event.state === "verified");

    expect(service.inspect().artifacts.filter(({ kind }) => kind === "field")).toHaveLength(1);
  });

  it("publishes immutable reentrant ordered events, isolates listeners, and honors unsubscribe", async () => {
    const registry = createSolverRegistry();
    const pending = gatedAdapter();
    registry.register(pending.adapter);
    const service = createEngineeringWorkspaceService(await workspaceOptions({ registry }));
    const revision = currentDocument(service).revision;
    const observed: string[] = [];
    let jobId = "";
    service.subscribe((event) => {
      expect(Object.isFrozen(event)).toBe(true);
      if (event.type === "job-changed" && event.entry.event.state === "running") {
        void service.cancelJob(event.entry.event.jobId).catch(() => undefined);
      }
      throw new Error("listener failure must be isolated");
    });
    const unsubscribe = service.subscribe((event) => observed.push(
      event.type === "job-changed" ? event.entry.event.state : event.type,
    ));

    ({ jobId } = await service.launchStudy({ studyId: "link-static", expectedRevision: revision }));
    await waitFor(() => service.inspectJob(jobId).event.state === "cancelled");
    unsubscribe();
    await service.apply(rename(currentDocument(service), "after-unsubscribe", "No observation"));

    expect(observed).toEqual(["queued", "artifacts-changed", "running", "cancelled"]);
  });

  it("dispose removes owned subscriptions and disposes the durable CAD adapter exactly once", async () => {
    const dispose = vi.fn();
    const service = createEngineeringWorkspaceService(await workspaceOptions({
      createCadAdapter: () => cadAdapter(async (request, _signal, emit) => emit(await cadResult(request)), dispose),
    }));
    const root = currentDocument(service);
    const listener = vi.fn();
    service.subscribe(listener);
    await service.rebuild({ requestId: "lease", expectedRevision: root.revision, outputs: ["step"], settings: {} });
    listener.mockClear();

    service.dispose();
    service.dispose();

    expect(dispose).toHaveBeenCalledOnce();
    await expect(service.apply(rename(root, "disposed", "Disposed"))).rejects.toThrow(/disposed/i);
    expect(listener).not.toHaveBeenCalled();
  });
});
