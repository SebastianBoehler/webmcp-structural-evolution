import { useEffect, type MutableRefObject } from "react";
import type { FoundationProjectState } from "../webmcp/schemas";
import type { ProjectStateOptions } from "./project-state-types";

export function useProjectOptionSync(
  options: ProjectStateOptions,
  contextRevision: string,
  stateRef: MutableRefObject<FoundationProjectState | null>,
  commit: (next: FoundationProjectState) => FoundationProjectState,
): void {
  const capabilityKey = JSON.stringify(options.capability);
  useEffect(() => {
    const current = stateRef.current!;
    if (JSON.stringify(current.capability) !== capabilityKey) {
      commit({ ...current, capability: options.capability });
    }
  }, [capabilityKey]);
  useEffect(() => {
    const current = stateRef.current!;
    if (current.contextRevision !== contextRevision) {
      commit({
        ...current,
        contextRevision,
        stagedBranches: current.stagedBranches.map((branch) => ({ ...branch, stale: true })),
      });
    }
  }, [contextRevision]);
}
