import type { EngineeringJobEvent } from "../cad/engineering-job-contract";
import { freezeSnapshot, type DeepReadonly } from "../domain/snapshots";

type QueuedEvent = Extract<EngineeringJobEvent, { state: "queued" }>;
type TerminalEvent = Extract<EngineeringJobEvent, { state: "verified" | "failed" | "cancelled" }>;
type TerminalState = TerminalEvent["state"];

export type JobLedgerEntry = DeepReadonly<{
  sequence: number;
  event: EngineeringJobEvent;
}>;

export type JobLedgerErrorCode = "duplicate-job-id" | "unknown-job-id" | "invalid-transition";

export class JobLedgerError extends Error {
  readonly code: JobLedgerErrorCode;

  constructor(code: JobLedgerErrorCode, message: string) {
    super(message);
    this.name = "JobLedgerError";
    this.code = code;
  }
}

export interface JobLedger {
  reserve(event: QueuedEvent): JobLedgerEntry;
  append(event: Exclude<EngineeringJobEvent, QueuedEvent>): JobLedgerEntry | undefined;
  entries(): readonly JobLedgerEntry[];
  isTerminal(jobId: string): boolean;
}

function cloneEvent(event: EngineeringJobEvent): EngineeringJobEvent {
  const common = { ...event, artifacts: [...event.artifacts] };
  if (event.state !== "failed") return common as EngineeringJobEvent;
  return {
    ...common,
    error: "limit" in event.error
      ? { ...event.error, limit: { ...event.error.limit } }
      : { ...event.error },
  } as EngineeringJobEvent;
}

function terminal(state: EngineeringJobEvent["state"]): state is TerminalState {
  return state === "verified" || state === "failed" || state === "cancelled";
}

export function createJobLedger(): JobLedger {
  const entries: JobLedgerEntry[] = [];
  const states = new Map<string, EngineeringJobEvent["state"]>();

  const append = (event: EngineeringJobEvent): JobLedgerEntry => {
    const entry = freezeSnapshot({ sequence: entries.length, event: cloneEvent(event) });
    entries.push(entry);
    states.set(event.jobId, event.state);
    return entry;
  };

  return {
    reserve(event): JobLedgerEntry {
      if (states.has(event.jobId)) {
        throw new JobLedgerError("duplicate-job-id", `Engineering job ID is already reserved: ${event.jobId}`);
      }
      return append(event);
    },
    append(event): JobLedgerEntry | undefined {
      const previous = states.get(event.jobId);
      if (!previous) {
        throw new JobLedgerError("unknown-job-id", `Engineering job ID is not reserved: ${event.jobId}`);
      }
      if (terminal(previous)) return undefined;
      if (event.state === "running" && previous !== "queued") {
        throw new JobLedgerError("invalid-transition", "Engineering jobs may enter running only from queued");
      }
      if (event.state === "partial" && previous !== "running" && previous !== "partial") {
        throw new JobLedgerError("invalid-transition", "Engineering jobs may emit partial progress only while running");
      }
      if (event.state === "verified" && previous !== "running" && previous !== "partial") {
        throw new JobLedgerError("invalid-transition", "Engineering jobs may verify only after running");
      }
      return append(event);
    },
    entries(): readonly JobLedgerEntry[] {
      return Object.freeze([...entries]);
    },
    isTerminal(jobId): boolean {
      const state = states.get(jobId);
      return state !== undefined && terminal(state);
    },
  };
}
