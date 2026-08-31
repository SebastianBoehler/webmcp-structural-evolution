import type { JobLedgerEntry } from "./job-ledger";

export type EngineeringJobSubscriber = (entry: JobLedgerEntry) => void;

export interface JobNotifier {
  publish(entry: JobLedgerEntry): void;
  subscribe(subscriber: EngineeringJobSubscriber): () => void;
}

export function createJobNotifier(): JobNotifier {
  const subscribers = new Map<number, EngineeringJobSubscriber>();
  const pending: JobLedgerEntry[] = [];
  let nextSubscriber = 0;
  let draining = false;

  const publish = (entry: JobLedgerEntry): void => {
    pending.push(entry);
    if (draining) return;
    draining = true;
    try {
      while (pending.length > 0) {
        const next = pending.shift()!;
        const snapshot = [...subscribers.values()];
        for (const subscriber of snapshot) {
          try {
            subscriber(next);
          } catch {
            // Isolate one UI callback from all ledger consumers.
          }
        }
      }
    } finally {
      draining = false;
    }
  };

  return {
    publish,
    subscribe(subscriber): () => void {
      const id = nextSubscriber;
      nextSubscriber += 1;
      subscribers.set(id, subscriber);
      return () => subscribers.delete(id);
    },
  };
}
