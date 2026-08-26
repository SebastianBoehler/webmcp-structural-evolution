export interface CleanupToken {
  relinquish(): void;
}

export interface CleanupLedger {
  own(release: () => void): CleanupToken;
  dispose(): void;
}

interface CleanupEntry {
  readonly release: () => void;
}

export function createCleanupLedger(): CleanupLedger {
  const entries = new Set<CleanupEntry>();
  let disposing = false;

  return {
    own(release) {
      const entry = { release };
      entries.add(entry);
      return {
        relinquish() {
          entries.delete(entry);
        },
      };
    },
    dispose() {
      if (disposing || entries.size === 0) return;
      disposing = true;
      try {
        for (const entry of [...entries]) {
          try {
            entry.release();
            entries.delete(entry);
          } catch {
            // Failed ownership remains in the ledger for the next disposal pass.
          }
        }
      } finally {
        disposing = false;
      }
    },
  };
}
