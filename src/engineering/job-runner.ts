import type { DesignDocument } from "../cad/document-schema";
import {
  type EngineeringJobError,
  type EngineeringJobEvent,
  type EngineeringSolveRequest,
} from "../cad/engineering-job-contract";
import type { ArtifactStore } from "./artifact-store";
import { createJobLedger, type JobLedger, type JobLedgerEntry } from "./job-ledger";
import {
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

export type EngineeringJobSubscriber = (entry: JobLedgerEntry) => void;

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
  readonly request: EngineeringSolveRequest<unknown>;
  readonly abortController: AbortController;
  readonly resolve: (completion: EngineeringJobCompletion<Output>) => void;
  progress: number;
  cancelling: boolean;
  terminal: boolean;
};

export function createEngineeringJobRunner(options: EngineeringJobRunnerOptions): EngineeringJobRunner {
  const ledger: JobLedger = createJobLedger();
  const controls = new Map<string, JobControl<unknown>>();
  const subscribers = new Map<number, EngineeringJobSubscriber>();
  let nextSubscriber = 0;

  const notify = (entry: JobLedgerEntry): void => {
    for (const subscriber of [...subscribers.values()]) {
      try {
        subscriber(entry);
      } catch {
        // Subscriber isolation keeps one UI consumer from interrupting the job ledger.
      }
    }
  };
  const active = (control: JobControl<unknown>): boolean =>
    !control.cancelling && !control.terminal && !ledger.isTerminal(control.request.jobId);
  const current = (control: JobControl<unknown>): boolean =>
    options.currentDocument().revision === control.request.sourceRevision;
  const publish = (event: Exclude<EngineeringJobEvent, Extract<EngineeringJobEvent, { state: "queued" }>>): JobLedgerEntry | undefined => {
    const entry = ledger.append(event);
    if (entry) notify(entry);
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
    notify(entry);
    return true;
  };
  const fail = (control: JobControl<unknown>, error: EngineeringJobError): void => {
    complete(control, {
      jobId: control.request.jobId,
      state: "failed",
      progress: control.progress,
      artifacts: [],
      error,
    });
  };
  const progress = (control: JobControl<unknown>, event: SolverProgressEvent): void => {
    if (!active(control) || !Number.isFinite(event?.progress)
      || event.progress < control.progress || event.progress >= 1) return;
    control.progress = event.progress;
    publish({
      jobId: control.request.jobId,
      state: "partial",
      progress: control.progress,
      artifacts: [],
    });
  };

  const dispatch = async (control: JobControl<unknown>): Promise<void> => {
    if (!active(control)) return;
    if (!current(control)) {
      fail(control, staleRevisionError());
      return;
    }
    let adapter;
    try {
      adapter = options.registry.resolve(control.request.kind, control.request);
    } catch (error) {
      if (active(control)) fail(control, toEngineeringJobError(error));
      return;
    }
    if (!active(control)) return;
    if (!current(control)) {
      fail(control, staleRevisionError());
      return;
    }
    publish({ jobId: control.request.jobId, state: "running", progress: control.progress, artifacts: [] });
    if (!active(control)) return;
    if (!current(control)) {
      fail(control, staleRevisionError());
      return;
    }
    let result: SolverRunResult<unknown>;
    try {
      result = await adapter.run(control.request, control.abortController.signal, (event) => progress(control, event));
    } catch (error) {
      if (active(control)) fail(control, toEngineeringJobError(error));
      return;
    }
    if (!active(control)) return;
    if (!current(control)) {
      fail(control, staleRevisionError());
      return;
    }
    try {
      const prepared = await prepareSolverRunResult(control.request, result);
      if (!active(control)) return;
      if (!current(control)) {
        fail(control, staleRevisionError());
        return;
      }
      for (const artifact of prepared.artifacts) {
        if (!active(control)) return;
        if (!current(control)) {
          fail(control, staleRevisionError());
          return;
        }
        await options.store.put(artifact.record, artifact.payload);
      }
      if (!active(control)) return;
      if (!current(control)) {
        fail(control, staleRevisionError());
        return;
      }
      complete(control, {
        jobId: control.request.jobId,
        state: "verified",
        truthLevel: prepared.truthLevel,
        progress: 1,
        artifacts: prepared.artifacts.map(({ record }) => record),
      }, prepared.output);
    } catch (error) {
      if (active(control)) fail(control, toEngineeringJobError(error));
    }
  };

  return {
    launch<Input, Output>(request: EngineeringSolveRequest<Input>): EngineeringJobHandle<Output> {
      let resolve!: (completion: EngineeringJobCompletion<Output>) => void;
      const completion = new Promise<EngineeringJobCompletion<Output>>((nextResolve) => { resolve = nextResolve; });
      const control: JobControl<Output> = {
        request: request as EngineeringSolveRequest<unknown>,
        abortController: new AbortController(),
        resolve,
        progress: 0,
        cancelling: false,
        terminal: false,
      };
      const queued = ledger.reserve({ jobId: request.jobId, state: "queued", progress: 0, artifacts: [] });
      controls.set(request.jobId, control as JobControl<unknown>);
      notify(queued);
      queueMicrotask(() => {
        void dispatch(control as JobControl<unknown>).catch((error: unknown) => {
          if (active(control as JobControl<unknown>)) fail(control as JobControl<unknown>, toEngineeringJobError(error));
        });
      });
      return { jobId: request.jobId, completion };
    },
    cancel(jobId): boolean {
      const control = controls.get(jobId);
      if (!control || control.terminal) return false;
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
      const id = nextSubscriber;
      nextSubscriber += 1;
      subscribers.set(id, subscriber);
      return () => subscribers.delete(id);
    },
    entries(): readonly JobLedgerEntry[] {
      return ledger.entries();
    },
  };
}
