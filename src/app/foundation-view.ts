import type { ViewerBranch } from "../viewer/alternative-instances";
import type { FoundationProjectState } from "../webmcp/schemas";

export function foundationView(state: FoundationProjectState) {
  const accepted = state.stagedBranches.find(
    (branch) => branch.branchRevision === state.acceptedBranchRevision && branch.result?.status === "verified",
  );
  const estimate = [...state.stagedBranches].reverse().find(
    (branch) => branch.parentRevision === state.contextRevision && !branch.stale && branch.result?.status === "estimate",
  );
  const preview = estimate ?? accepted ?? [...state.stagedBranches].reverse().find(
    (branch) => branch.result?.status === "verified" && !branch.stale,
  );
  const alternatives = state.stagedBranches.filter(
    (branch) => branch.branchRevision !== preview?.branchRevision && branch.result?.status === "verified",
  );
  const viewerCurrent: ViewerBranch | null = preview?.result && (preview.result.status === "verified" || preview.result.status === "estimate") ? {
    branchRevision: preview.branchRevision,
    contextRevision: state.contextRevision,
    parentRevision: preview.parentRevision,
    grid: preview.result.grid ?? state.context.grid,
    result: preview.result,
  } : null;
  const viewerAlternatives: readonly ViewerBranch[] = viewerCurrent?.result.status === "verified" ? alternatives.map((branch) => ({
    branchRevision: branch.branchRevision,
    contextRevision: branch.parentRevision,
    parentRevision: branch.parentRevision,
    grid: branch.result?.status === "verified" ? branch.result.grid ?? state.context.grid : state.context.grid,
    result: branch.result!,
  })) : [];
  const currentVerified = alternatives.filter(
    (branch) => branch.parentRevision === state.contextRevision && !branch.stale && branch.status === "verified",
  );
  const currentBranches = state.stagedBranches.filter(
    (branch) => branch.parentRevision === state.contextRevision && !branch.stale,
  );
  return { accepted, preview, alternatives, viewerCurrent, viewerAlternatives, currentVerified, currentBranches };
}
