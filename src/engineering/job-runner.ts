import type { DesignDocument } from "../cad/document-schema";
import {
  type EngineeringJobError,
  type EngineeringJobEvent,
  type EngineeringSolveRequest,
} from "../cad/engineering-job-contract";
import type { ArtifactStore } from "./artifact-store";
import { createJobLedger, type JobLedger, type JobLedgerEntry } from "./job-ledger";
import { createJobNotifier, type EngineeringJobSubscriber } from "./job-notifier";
import { hasBoundDocumentRevision, captureEngineeringSolveRequest } from "./job-request-snapshot";
import {
  invalidInputError,
  prepareSolverRunResult,
  staleRevisionError,
  toEngineeringJobError,
} from "./job-runner-result";
import type { SolverRegistry } from "./solver-registry";
import type { SolverProgressEvent, SolverRunResult } from "./solver-adapter";

type TerminalEvent = Extract<EngineeringJobEvent, { state: "verified" | "failed" | "cancelled" }>;
type VerifiedEvent = Extract<TerminalEvent, { state: "verified" }>;

export type EngineeringJobCompletion<Output> = Readonly<
  | { event: VerifiedEvent; output: Output }
  | { event: Exclude<TerminalEvent, VerifiedEvent> }
>;

export type EngineeringJobHandle<Output> = Readonly<{
  jobId: string;
  completion: Promise<EngineeringJobCompletion<Output>>;
}>;

export type { EngineeringJobSubscriber } from "./job-notifier";

export interface EngineeringJobRunner {
  launch<Input, Output>(request: EngineeringSolveRequest<Input>): EngineeringJobHandle<Output>;
  cancel(jobId: string): boolean;
  subscribe(subscriber: EngineeringJobSubscriber): () => void;
  entries(): readonly JobLedgerEntry[];
}

export interface EngineeringJobRunnerOptions {
  readonly registry: SolverRegistry;
  readonly store: ArtifactStore;
  readonly currentDocument: () => DesignDocument;
}

type JobControl<Output> = {
  readonly jobId: string;
  readonly request: EngineeringSolveRequest<unknown>;
  readonly abortController: AbortController;
  readonly resolve: (completion: EngineeringJobCompletion<Output>) => void;
  progress: number;
  cancelling: boolean;
  commitAccepted: boolean;
  terminal: boolean;
};

export function createEngineeringJobRunner(options: EngineeringJobRunnerOptions): EngineeringJobRunner {
  const ledger: JobLedger = createJobLedger();
  const notifier = createJobNotifier();
  const controls = new Map<string, JobControl<unknown>>();
  const active = (control: JobControl<unknown>): boolean =>
    !control.cancelling && !control.terminal && !ledger.isTerminal(control.jobId);
  const current = (control: JobControl<unknown>): boolean =>
    options.currentDocument().revision === control.request.sourceRevision;
  const bound = (control: JobControl<unknown>): boolean => hasBoundDocumentRevision(control.request);
  const publish = (event: Exclude<EngineeringJobEvent, Extract<EngineeringJobEvent, { state: "queued" }>>): JobLedgerEntry | undefined => {
    const entry = ledger.append(event);
    if (entry) notifier.publish(entry);
    return entry;
  };
  const complete = <Output>(
    control: JobControl<Output>,
    event: TerminalEvent,
    output?: Output,
  ): boolean => {
    if (control.terminal) return false;
    const entry = ledger.append(event);
    if (!entry) {
      control.terminal = true;
      return false;
    }
    control.terminal = true;
    const completion = event.state === "verified"
      ? { event: entry.event as VerifiedEvent, output: output as Output }
      : { event: entry.event as Exclude<TerminalEvent, VerifiedEvent> };
    control.resolve(completion);
    notifier.publish(entry);
    return true;
  };
  const fail = (control: JobControl<unknown>, error: EngineeringJobError): void => {
    complete(control, {
      jobId: control.jobId,
      state: "failed",
      progress: control.progress,
      artifacts: [],
      error,
    });
  };
  const invalidOrStale = (control: JobControl<unknown>): boolean => {
    if (!bound(control)) {
      fail(control, invalidInputError("Solve request document revision is not bound to its source revision"));
      return true;
    }
    try {
      if (!current(control)) {
        fail(control, staleRevisionError());
        return true;
      }
    } catch (error) {
      fail(control, toEngineeringJobError(error));
      return true;
    }
    return false;
  };
  const acceptCommit = (control: JobControl<unknown>): boolean => {
    if (control.commitAccepted) return false;
    if (!active(control) || invalidOrStale(control)) return false;
    if (!active(control) || !bound(control)) return false;
    control.commitAccepted = true;
    return true;
  };
  const progress = (control: JobControl<unknown>, event: SolverProgressEvent): void => {
    if (!active(control) || control.commitAccepted || !Number.isFinite(event?.progress)
      || event.progress < control.progress || event.progress >= 1) return;
    control.progress = event.progress;
    publish({ jobId: control.jobId, state: "partial", progress: control.progress, artifacts: [] });
  };

  const dispatch = async (control: JobControl<unknown>): Promise<void> => {
    if (!active(control) || invalidOrStale(control)) return;
    let adapter;
    try {
      adapter = options.registry.resolve(control.request.kind, control.request);
    } catch (error) {
      if (active(control) && !invalidOrStale(control)) fail(control, toEngineeringJobError(error));
      return;
    }
    if (!active(control) || invalidOrStale(control)) return;
    publish({ jobId: control.jobId, state: "running", progress: control.progress, artifacts: [] });
    if (!active(control) || invalidOrStale(control)) return;
    let result: SolverRunResult<unknown>;
    try {
      result = await adapter.run(control.request, control.abortController.signal, (event) => progress(control, event));
    } catch (error) {
      if (active(control) && !invalidOrStale(control)) fail(control, toEngineeringJobError(error));
      return;
    }
    if (!active(control) || invalidOrStale(control)) return;
    try {
      const prepared = await prepareSolverRunResult(control.request, result);
      if (!active(control) || invalidOrStale(control)) return;
      await options.store.commit(prepared.artifacts, () => acceptCommit(control));
      if (!control.commitAccepted) {
        if (active(control) && !invalidOrStale(control)) {
          fail(control, { code: "internal-error", message: "Artifact store completed without accepting the commit fence" });
        }
        return;
      }
      complete(control, {
        jobId: control.jobId,
        state: "verified",
        truthLevel: prepared.truthLevel,
        progress: 1,
        artifacts: prepared.artifacts.map(({ record }) => record),
      }, prepared.output);
    } catch (error) {
      if (control.commitAccepted) {
        fail(control, toEngineeringJobError(error));
      } else if (active(control) && !invalidOrStale(control)) {
        fail(control, toEngineeringJobError(error));
      }
    }
  };

  return {
    launch<Input, Output>(request: EngineeringSolveRequest<Input>): EngineeringJobHandle<Output> {
      let snapshot: EngineeringSolveRequest<unknown>;
      try {
        snapshot = captureEngineeringSolveRequest(request) as EngineeringSolveRequest<unknown>;
      } catch {
        throw invalidInputError("Solve request state cannot contain shared or uncloneable memory");
      }
      const jobId = snapshot.jobId;
      let resolve!: (completion: EngineeringJobCompletion<Output>) => void;
      const completion = new Promise<EngineeringJobCompletion<Output>>((nextResolve) => { resolve = nextResolve; });
      const queued = ledger.reserve({ jobId, state: "queued", progress: 0, artifacts: [] });
      const control: JobControl<Output> = {
        jobId,
        request: snapshot,
        abortController: new AbortController(),
        resolve,
        progress: 0,
        cancelling: false,
        commitAccepted: false,
        terminal: false,
      };
      controls.set(jobId, control as JobControl<unknown>);
      notifier.publish(queued);
      queueMicrotask(() => {
        void dispatch(control as JobControl<unknown>).catch((error: unknown) => {
          if (active(control as JobControl<unknown>) && !invalidOrStale(control as JobControl<unknown>)) {
            fail(control as JobControl<unknown>, toEngineeringJobError(error));
          }
        });
      });
      return { jobId, completion };
    },
    cancel(jobId): boolean {
      const control = controls.get(jobId);
      if (!control || control.terminal || control.commitAccepted) return false;
      control.cancelling = true;
      control.abortController.abort();
      return complete(control, {
        jobId,
        state: "cancelled",
        progress: control.progress,
        artifacts: [],
      });
    },
    subscribe(subscriber): () => void {
      return notifier.subscribe(subscriber);
    },
    entries(): readonly JobLedgerEntry[] {
      return ledger.entries();
    },
  };
}
