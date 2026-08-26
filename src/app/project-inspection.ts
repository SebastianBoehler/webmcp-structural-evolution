import { comparableBranchPair, hasComparableBranches } from "../webmcp/comparability";
import type {
  FoundationBranch,
  FoundationProjectState,
  InspectContextFacts,
} from "../webmcp/schemas";
import { toolFactsFit } from "../webmcp/tool-output";

const MAX_INSPECT_BRANCHES = 2;

function inspectableBranches(branches: readonly FoundationBranch[]): readonly FoundationBranch[] {
  const pair = comparableBranchPair(branches);
  if (pair) return pair;
  const distinct = new Map<string, FoundationBranch>();
  for (const branch of branches) distinct.set(branch.branchRevision, branch);
  return [...distinct.values()].slice(-MAX_INSPECT_BRANCHES);
}

function buildFacts(
  state: FoundationProjectState,
  selected: readonly FoundationBranch[],
): InspectContextFacts {
  return {
    contextRevision: state.contextRevision,
    selection: state.selection,
    locks: state.locks,
    acceptedBranchRevision: state.acceptedBranchRevision,
    stagedBranches: selected.map((branch) => ({
      parentRevision: branch.parentRevision,
      proposalRevision: branch.proposalRevision,
      branchRevision: branch.branchRevision,
      attempt: branch.attempt,
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

export function inspectProjectFacts(state: FoundationProjectState): InspectContextFacts {
  let selected = inspectableBranches(state.stagedBranches);
  let facts = buildFacts(state, selected);
  while (selected.length > 0 && !toolFactsFit(facts)) {
    selected = selected.slice(1);
    facts = buildFacts(state, selected);
  }
  return facts;
}
