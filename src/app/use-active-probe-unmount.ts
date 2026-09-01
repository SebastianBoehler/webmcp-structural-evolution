import { useEffect, type MutableRefObject } from "react";
import type { ActiveProbeOperation } from "./project-probe-cancellation";

export function useActiveProbeUnmount(
  operationRef: MutableRefObject<ActiveProbeOperation | null>,
  cancel: (operation: ActiveProbeOperation) => Promise<unknown>,
): void {
  useEffect(() => () => {
    const operation = operationRef.current;
    if (!operation) return;
    operation.abandoned = true;
    if (operation.branchRevision) void cancel(operation).catch(() => undefined);
    else {
      operation.detachExternalAbort?.();
      operation.controller.abort();
      operationRef.current = null;
    }
  }, []);
}
