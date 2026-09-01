import type { ArtifactRecord } from "../cad/artifact-contract";
import type { JobLedgerEntry } from "../engineering/job-ledger";
import { WorkspaceError } from "./workspace-cad";

export function uniqueArtifacts(records: readonly ArtifactRecord[]): ArtifactRecord[] {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

export function ownWorkspaceValue<Value>(value: Value): Value {
  try { return structuredClone(value); }
  catch { throw new WorkspaceError("invalid-input", "Workspace request cannot contain shared or uncloneable memory"); }
}

export function latestJobEntry(entries: readonly JobLedgerEntry[], jobId: string): JobLedgerEntry {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.event.jobId === jobId) return entry;
  }
  throw new WorkspaceError("unknown-job", `Engineering job is unknown: ${jobId}`);
}
