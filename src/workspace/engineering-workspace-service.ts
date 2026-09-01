import type { DesignTransaction } from "../cad/command-schema";
import { applyDesignSessionTransaction, attachDesignSessionArtifacts } from "../cad/design-session";
import type { CadKernelAdapter } from "../cad/runtime-contracts";
import { defineActionReceipt, type ActionReceipt } from "../domain/receipts";
import { revisionId } from "../domain/revisions";
import { freezeSnapshot } from "../domain/snapshots";
import { ArtifactStoreError, createArtifactStore, synchronizeArtifactStoreInvalidation } from "../engineering/artifact-store";
import { createEngineeringJobRunner, type EngineeringJobRunner } from "../engineering/job-runner";
import { evaluateCad, runDryRun, WorkspaceError } from "./workspace-cad";
import { compareWorkspaceResults, exportWorkspaceArtifact } from "./workspace-authority";
import { createWorkspaceEventBus, type WorkspaceEventInput } from "./workspace-events";
import { createWorkspaceMutationQueue } from "./workspace-mutation-queue";
import { validateStudyCompilation, type StudyRequestPlanner } from "./workspace-study-plan";
import type { EngineeringWorkspaceOptions, EngineeringWorkspaceService } from "./workspace-service-contract";
import type { WorkspaceInspection } from "./workspace-inspection";
import { acquireExactComponentSource } from "./exact-component-source";
import { createExactComponentSourceLease } from "./exact-component-source-lease";
import { createWorkspaceDerivationAuthority } from "./workspace-derivation-receipt";
import { boundComponentPlanner, componentDerivationProof } from "./workspace-component-derivation";
import { latestJobEntry, ownWorkspaceValue as own, uniqueArtifacts } from "./workspace-service-helpers";

export type { StudyCompilation, StudyRequestPlanner, StudyRequestPlanners } from "./workspace-study-plan";
export type { EngineeringWorkspaceOptions, EngineeringWorkspaceService, LaunchStudyRequest } from "./workspace-service-contract";

export function createEngineeringWorkspaceService(options: EngineeringWorkspaceOptions): EngineeringWorkspaceService {
  let session = options.session;
  let adapter: CadKernelAdapter | undefined;
  let disposed = false;
  let inspectionCache: WorkspaceInspection | undefined;
  const mutations = createWorkspaceMutationQueue();
  const bus = createWorkspaceEventBus();
  const rawExports = new Map<string, Uint8Array>();
  const verifiedIds = new Set<string>();
  const jobRevisions = new Map<string, string>();
  const usedNonces = new Set<string>();
  const document = () => session.history.documents[session.history.headRevision]!;
  const active = () => session.artifacts.index.artifacts;
  const assertActive = () => {
    if (disposed) throw new WorkspaceError("disposed", "Engineering workspace service is disposed");
  };
  const runner: EngineeringJobRunner = createEngineeringJobRunner({
    registry: options.registry,
    store: options.store,
    currentDocument: document,
    finalize: (finalization) => mutations.run(async () => {
      if (disposed || document().revision !== finalization.sourceRevision) {
        finalization.fail({
          code: "stale-revision",
          message: "Source revision is no longer the current design document",
        });
        return;
      }
      const existing = new Set(active().map(({ id }) => id));
      const records = uniqueArtifacts(finalization.artifacts.map(({ record }) => record));
      const next = records.filter(({ id }) => !existing.has(id));
      const nextSession = next.length ? attachDesignSessionArtifacts(session, next) : session;
      await finalization.commit();
      session = nextSession;
      if (!finalization.verify()) {
        throw new WorkspaceError("job-finalization-failed", "Engineering job could not enter verified state");
      }
    }),
  });
  const publish = (event: WorkspaceEventInput) => {
    inspectionCache = undefined;
    bus.publish(event);
  };
  const runnerUnsubscribe = runner.subscribe((entry) => {
    if (disposed) return;
    if (entry.event.state === "verified") {
      const records = uniqueArtifacts(entry.event.artifacts);
      records.forEach(({ id }) => verifiedIds.add(id));
      publish({ type: "artifacts-changed", headRevision: document().revision,
        artifactIds: records.map(({ id }) => id) });
    }
    publish({ type: "job-changed", entry });
    if (["verified", "failed", "cancelled"].includes(entry.event.state)) {
      jobRevisions.delete(entry.event.jobId);
    }
  });
  const exactSources = createExactComponentSourceLease(
    (expected, signal) => {
      adapter ??= options.createCadAdapter();
      return acquireExactComponentSource(expected, adapter, signal);
    },
    (source, expected) => mutations.run(async () => {
      if (disposed || document().revision !== expected.revision) {
        throw new WorkspaceError("stale-revision", "Exact component source completed for a stale revision");
      }
      const existing = new Set(active().map(({ id }) => id));
      const next = source.allArtifacts.filter(({ id }) => !existing.has(id));
      await options.store.commit(source.entries, () => !disposed && document().revision === expected.revision);
      if (next.length) {
        session = attachDesignSessionArtifacts(session, next);
        publish({ type: "artifacts-changed", headRevision: document().revision,
          artifactIds: next.map(({ id }) => id) });
      }
    }),
  );
  const derivations = createWorkspaceDerivationAuthority();

  const inspection = (): WorkspaceInspection => {
    inspectionCache ??= freezeSnapshot({
      document: document(),
      headRevision: session.history.headRevision,
      acceptedRevision: session.history.acceptedRevision,
      artifacts: active(),
      artifactCount: active().length,
      invalidatedArtifactCount: session.artifacts.invalidatedIds.length,
      jobs: runner.entries(),
      receipts: session.receipts,
      receiptCount: session.receipts.length,
    });
    return inspectionCache;
  };

  const applyOne = async (transaction: DesignTransaction): Promise<ActionReceipt> => {
    assertActive();
    for (;;) {
      const base = session;
      const result = await applyDesignSessionTransaction(base, transaction, options.clock);
      if (session !== base) continue;
      const receipt = result.session.receipts.at(-1)!;
      const changed = result.result.ok && result.result.document.revision !== transaction.expectedRevision;
      if (changed) {
        exactSources.invalidate();
        await synchronizeArtifactStoreInvalidation(options.store, result.session.artifacts);
      }
      session = result.session;
      if (changed) {
        for (const id of result.session.artifacts.invalidatedIds) {
          rawExports.delete(id);
          verifiedIds.delete(id);
        }
        for (const [jobId, revision] of jobRevisions)
          if (revision !== document().revision) runner.cancel(jobId);
      }
      publish({ type: "transaction-recorded", receipt, headRevision: document().revision, designChanged: changed });
      return receipt;
    }
  };

  return {
    inspect() { assertActive(); return inspection(); },
    dryRun(request, signal = new AbortController().signal) {
      assertActive();
      const snapshot = own(request);
      if (snapshot.transaction.expectedRevision !== document().revision) {
        return Promise.reject(new WorkspaceError("stale-revision", "Dry-run expected revision is stale"));
      }
      return runDryRun(document(), snapshot, signal, options.createCadAdapter,
        options.createEphemeralStore ?? createArtifactStore, options.clock);
    },
    apply(transaction) {
      let snapshot: DesignTransaction;
      try { snapshot = own(transaction); }
      catch (error) { return Promise.reject(error); }
      return mutations.run(() => applyOne(snapshot));
    },
    async rebuild(request, signal = new AbortController().signal) {
      assertActive();
      request = own(request);
      if (request.expectedRevision !== document().revision) {
        throw new WorkspaceError("stale-revision", "Rebuild expected revision is stale");
      }
      adapter ??= options.createCadAdapter();
      const evaluated = await evaluateCad(adapter, document(), request, signal);
      const createdAt = options.clock.now();
      const receipt = defineActionReceipt({
        id: await revisionId({ action: "rebuild", request, createdAt }),
        action: "rebuild",
        validatedInputs: request,
        affectedRevision: request.expectedRevision,
        outcome: { status: "succeeded", result: { artifactIds: evaluated.artifacts.map(({ id }) => id) } },
        duration: { value: Math.max(0, options.clock.elapsedMs()), unit: "ms" },
        createdAt,
      });
      return mutations.run(async () => {
        if (document().revision !== request.expectedRevision) {
          throw new WorkspaceError("stale-revision", "Rebuild completed for a stale revision");
        }
        const existing = new Set(active().map(({ id }) => id));
        const next = uniqueArtifacts(evaluated.artifacts).filter(({ id }) => !existing.has(id));
        const nextSession = next.length ? attachDesignSessionArtifacts(session, next) : session;
        try {
          await options.store.commit(evaluated.inputs,
            () => !disposed && document().revision === request.expectedRevision);
        } catch (error) {
          if (error instanceof ArtifactStoreError && error.code === "commit-guard-rejected") {
            throw new WorkspaceError("stale-revision", "Rebuild completed for a stale revision");
          }
          throw error;
        }
        session = nextSession;
        evaluated.exportPayloads.forEach((payload, id) => rawExports.set(id, payload));
        publish({ type: "artifacts-changed", headRevision: document().revision,
          artifactIds: evaluated.artifacts.map(({ id }) => id) });
        return receipt;
      });
    },
    async launchStudy(request) {
      assertActive();
      request = own(request);
      const current = document();
      if (request.expectedRevision !== current.revision) throw new WorkspaceError("stale-revision", "Study launch expected revision is stale");
      const study = current.studies.find(({ id }) => id === request.studyId);
      if (!study) throw new WorkspaceError("unknown-study", `Study is unresolved: ${request.studyId}`);
      const planner = options.planners[study.kind] as StudyRequestPlanner<typeof study.kind> | undefined;
      if (!planner) throw new WorkspaceError("unavailable-study-planner", `No planner is registered for study kind: ${study.kind}`);
      const plannerAuthority = boundComponentPlanner(planner, current);
      let acquiredExact: Awaited<ReturnType<typeof exactSources.get>> | undefined;
      const planned = await planner({ document: current, study: study as never, artifacts: active(),
        exactSource: async () => {
          acquiredExact = await exactSources.get(current);
          return acquiredExact;
        } });
      if (document().revision !== request.expectedRevision) throw new WorkspaceError("stale-revision", "Study launch became stale while planning");
      const proof = await componentDerivationProof(
        plannerAuthority, acquiredExact, planned, derivations,
      );
      const compilation = await validateStudyCompilation(
        planned, current, study, active(), proof,
      );
      if (document().revision !== request.expectedRevision) {
        throw new WorkspaceError("stale-revision", "Study launch became stale during request validation");
      }
      return mutations.run(async () => {
        if (document().revision !== request.expectedRevision) {
          throw new WorkspaceError("stale-revision", "Study launch became stale before input commit");
        }
        const existing = new Set(active().map(({ id }) => id));
        const next = compilation.inputs.map(({ record }) => record)
          .filter(({ id }) => !existing.has(id));
        const nextSession = next.length ? attachDesignSessionArtifacts(session, next) : session;
        const reservation = runner.reserve(compilation.request);
        jobRevisions.set(reservation.jobId, compilation.request.sourceRevision);
        try {
          await options.store.commit(compilation.inputs,
            () => !disposed && document().revision === request.expectedRevision);
          session = nextSession;
          if (next.length) publish({ type: "artifacts-changed", headRevision: document().revision,
            artifactIds: next.map(({ id }) => id) });
          reservation.start();
          return { jobId: reservation.jobId };
        } catch (error) {
          runner.cancel(reservation.jobId);
          throw error;
        }
      });
    },
    async cancelJob(jobId) {
      assertActive();
      if (!runner.cancel(jobId)) throw new WorkspaceError("job-not-cancellable", `Engineering job cannot be cancelled: ${jobId}`);
    },
    inspectJob(jobId) { assertActive(); return latestJobEntry(runner.entries(), jobId); },
    compareResults(left, right) {
      assertActive();
      const head = document().revision;
      return compareWorkspaceResults(left, right, active(), verifiedIds, options.store,
        () => document().revision === head
          && [left, right].every((id) => verifiedIds.has(id) && active().some((record) => record.id === id)));
    },
    exportArtifact(artifactId, approval) {
      assertActive();
      approval = own(approval);
      if (!options.verifyExportApproval) return Promise.reject(new WorkspaceError(
        "approval-authority-unavailable", "Export approval authority is unavailable",
      ));
      return exportWorkspaceArtifact(artifactId, approval, document().revision, active(),
        rawExports, usedNonces, options.verifyExportApproval,
        () => {
          const eligible = active().find(({ id }) => id === artifactId);
          return document().revision === approval.headRevision
            && eligible?.kind === "export"
            && eligible.sourceRevision === approval.sourceRevision
            && eligible.contentDigest === approval.contentDigest
            && eligible.mediaType === approval.mediaType
            && rawExports.has(artifactId);
        });
    },
    subscribe(listener) { assertActive(); return bus.subscribe(listener); },
    dispose() {
      if (disposed) return;
      disposed = true;
      exactSources.invalidate();
      runnerUnsubscribe();
      for (const entry of runner.entries()) runner.cancel(entry.event.jobId);
      adapter?.dispose?.();
      adapter = undefined;
      rawExports.clear();
      bus.clear();
    },
  };
}
