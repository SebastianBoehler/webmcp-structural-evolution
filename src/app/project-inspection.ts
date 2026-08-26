import { comparableBranchPair, hasComparableBranches } from "../webmcp/comparability";
import type {
  FoundationBranch,
  FoundationProjectState,
  InspectContextFacts,
} from "../webmcp/schemas";

const MAX_INSPECT_BRANCHES = 2;

function inspectableBranches(branches: readonly FoundationBranch[]): readonly FoundationBranch[] {
  const pair = comparableBranchPair(branches);
  if (pair) return pair;
  const distinct = new Map<string, FoundationBranch>();
  for (const branch of branches) distinct.set(branch.branchRevision, branch);
  return [...distinct.values()].slice(-MAX_INSPECT_BRANCHES);
}

export function inspectProjectFacts(state: FoundationProjectState): InspectContextFacts {
  const selected = inspectableBranches(state.stagedBranches);
  return {
    contextRevision: state.contextRevision,
    selection: state.selection,
    locks: state.locks,
    acceptedBranchRevision: state.acceptedBranchRevision,
    stagedBranches: selected.map((branch) => ({
      parentRevision: branch.parentRevision,
      branchRevision: branch.branchRevision,
      hypothesis: branch.hypothesis,
      prediction: branch.prediction,
      status: branch.status,
      stale: branch.stale,
      measurement: branch.measurement && {
        status: branch.measurement.status,
        elapsedMs: branch.measurement.elapsedMs,
        relativeL2: branch.measurement.relativeL2,
        resultDigest: branch.measurement.resultDigest,
      },
    })),
    stagedBranchCount: state.stagedBranches.length,
    omittedBranchCount: state.stagedBranches.length - selected.length,
    capability: state.capability,
    stale: state.stagedBranches.some((branch) => branch.stale),
    nextActions: [
      ...(state.capability.status === "available" && state.operationStatus === "idle"
        ? ["run_foundation_probe"]
        : []),
      ...(hasComparableBranches(state.stagedBranches) ? ["compare_foundation_probes"] : []),
    ],
  };
}
