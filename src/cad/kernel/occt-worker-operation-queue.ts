import type { PendingOcctOperation } from "./occt-worker-client-types";

function cancelNotStarted(operation: PendingOcctOperation): void {
  if (operation.kind === "evaluation") {
    operation.emit({
      requestId: operation.requestId, state: "cancelled", workerDisposition: "not-started",
    });
    operation.resolve();
    return;
  }
  operation.reject(new DOMException("Exact STEP import was cancelled", "AbortError"));
}

export function createOcctWorkerOperationQueue(startNext: () => void) {
  const pending: PendingOcctOperation[] = [];
  let closed = false;
  return {
    dequeue(): PendingOcctOperation | undefined { return pending.shift(); },
    hasPending(): boolean { return pending.length > 0; },
    enqueue(operation: PendingOcctOperation): void {
      if (closed) cancelNotStarted(operation);
      else {
        pending.push(operation);
        startNext();
      }
    },
    dispose(): void {
      if (closed) return;
      closed = true;
      for (const operation of pending.splice(0)) cancelNotStarted(operation);
    },
  };
}
