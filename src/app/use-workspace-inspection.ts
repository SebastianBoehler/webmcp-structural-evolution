import { useCallback, useSyncExternalStore } from "react";
import type { EngineeringWorkspaceService } from "../workspace/engineering-workspace-service";
import type { WorkspaceInspection } from "../workspace/workspace-inspection";

export function useWorkspaceInspection(
  workspace: EngineeringWorkspaceService | undefined,
): WorkspaceInspection | null {
  const subscribe = useCallback((notify: () => void) => (
    workspace ? workspace.subscribe(() => notify()) : () => undefined
  ), [workspace]);
  const getSnapshot = useCallback(() => workspace?.inspect() ?? null, [workspace]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
