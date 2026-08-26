import type { ViewerBranch } from "../viewer/alternative-instances";
import type { FoundationProjectState } from "../webmcp/schemas";

export function foundationView(state: FoundationProjectState) {
  const accepted = state.stagedBranches.find(
    (branch) => branch.branchRevision === state.acceptedBranchRevision && branch.result?.status === "verified",
  );
  const alternatives = state.stagedBranches.filter(
    (branch) => branch.branchRevision !== state.acceptedBranchRevision && branch.result?.status === "verified",
  );
  const viewerCurrent: ViewerBranch | null = accepted?.result?.status === "verified" ? {
    branchRevision: accepted.branchRevision,
    contextRevision: state.contextRevision,
    parentRevision: accepted.parentRevision,
    grid: state.context.grid,
    result: accepted.result,
  } : null;
  const viewerAlternatives: readonly ViewerBranch[] = alternatives.map((branch) => ({
    branchRevision: branch.branchRevision,
    contextRevision: branch.parentRevision,
    parentRevision: branch.parentRevision,
    grid: state.context.grid,
    result: branch.result!,
  }));
  const currentVerified = alternatives.filter(
    (branch) => branch.parentRevision === state.contextRevision && !branch.stale && branch.status === "verified",
  );
  const currentBranches = state.stagedBranches.filter(
    (branch) => branch.parentRevision === state.contextRevision && !branch.stale,
  );
  return { accepted, alternatives, viewerCurrent, viewerAlternatives, currentVerified, currentBranches };
}
