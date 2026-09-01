import type { ActionReceipt } from "../domain/receipts";
import { freezeSnapshot, type DeepReadonly } from "../domain/snapshots";
import type { JobLedgerEntry } from "../engineering/job-ledger";

export type WorkspaceEvent = DeepReadonly<
  | { type: "transaction-recorded"; sequence: number; receipt: ActionReceipt; headRevision: string; designChanged: boolean }
  | { type: "artifacts-changed"; sequence: number; headRevision: string; artifactIds: readonly string[] }
  | { type: "job-changed"; sequence: number; entry: JobLedgerEntry }
>;
type EventInput<Event> = Event extends WorkspaceEvent ? Omit<Event, "sequence"> : never;
export type WorkspaceEventInput = EventInput<WorkspaceEvent>;

export interface WorkspaceEventBus {
  publish(event: WorkspaceEventInput): void;
  subscribe(listener: (event: WorkspaceEvent) => void): () => void;
  clear(): void;
}

export function createWorkspaceEventBus(): WorkspaceEventBus {
  const listeners = new Map<number, (event: WorkspaceEvent) => void>();
  const pending: WorkspaceEvent[] = [];
  let nextListener = 0;
  let nextSequence = 0;
  let draining = false;
  const publish = (value: WorkspaceEventInput) => {
    pending.push(freezeSnapshot({ ...value, sequence: nextSequence++ }) as WorkspaceEvent);
    if (draining) return;
    draining = true;
    try {
      while (pending.length) {
        const event = pending.shift()!;
        for (const listener of [...listeners.values()]) {
          try { listener(event); } catch { /* Listener isolation is part of the public contract. */ }
        }
      }
    } finally { draining = false; }
  };
  return {
    publish,
    subscribe(listener) {
      const id = nextListener++;
      listeners.set(id, listener);
      return () => { listeners.delete(id); };
    },
    clear() { listeners.clear(); pending.length = 0; },
  };
}
