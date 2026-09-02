import type { FoundationBranch, FoundationProjectState, ProbeVariant } from "../webmcp/schemas";

interface OptimizationNavigation {
  readonly nextVariant?: ProbeVariant;
  readonly pendingPromotion?: FoundationBranch;
  readonly pendingEstimate?: FoundationBranch;
  readonly readyToCompare: boolean;
  readonly primaryLabel: string;
  readonly primaryDisabled: boolean;
}

export function deriveOptimizationNavigation(
  state: FoundationProjectState,
  currentBranches: readonly FoundationBranch[],
  accepted: boolean,
  currentVerifiedCount: number,
  layoutVerified: boolean,
  topologySubject = "frame",
): OptimizationNavigation {
  const nonStaleBranches = currentBranches.filter((branch) => !branch.stale);
  const latestVariant = (variant: ProbeVariant) => [...nonStaleBranches].reverse().find(
    (branch) => branch.variant === variant,
  );
  const canRetry = (variant: ProbeVariant) => {
    const status = latestVariant(variant)?.status;
    return !status || status === "failed" || status === "mismatch" || status === "canceled";
  };
  const balanced = latestVariant("balanced");
  const balancedTopology = balanced?.result?.status === "verified" ? balanced.result.topology : undefined;
  const balancedFailsMaterialScreen = balancedTopology !== undefined && balancedTopology.minimumSafetyFactor < 1;
  const nextVariant = !accepted
    ? canRetry("balanced") ? "balanced"
      : balancedFailsMaterialScreen && canRetry("stiffness") ? "stiffness" : undefined
    : canRetry("lightweight") ? "lightweight"
      : latestVariant("lightweight")?.status === "verified" && canRetry("stiffness") ? "stiffness" : undefined;
  const pendingPromotion = nonStaleBranches.find(
    (branch) => branch.status === "verified" && branch.branchRevision !== state.acceptedBranchRevision,
  );
  const readyToCompare = accepted && currentVerifiedCount >= 2;
  const pendingEstimate = !nextVariant && !readyToCompare && !pendingPromotion
    ? [...nonStaleBranches].reverse().find((branch) => branch.status === "estimate")
    : undefined;
  const retrying = nextVariant !== undefined && latestVariant(nextVariant) !== undefined;
  const primaryLabel = !layoutVerified ? "Topology context needs rebuild"
    : state.operationStatus === "running" ? "Optimizing frame…"
      : state.operationStatus === "canceling" ? "Canceling…"
        : nextVariant === "balanced" ? `${retrying ? "Retry" : "Generate"} balanced ${topologySubject}`
          : nextVariant === "lightweight" ? `${retrying ? "Retry" : "Generate"} lightweight ${topologySubject}`
            : nextVariant === "stiffness" ? `${retrying ? "Retry" : "Generate"} stiffness-first ${topologySubject}`
              : readyToCompare ? "Compare alternatives"
                : pendingPromotion ? "Review topology candidate"
                  : pendingEstimate ? "Review interactive estimate" : "No action available";
  return {
    nextVariant,
    pendingPromotion,
    pendingEstimate,
    readyToCompare,
    primaryLabel,
    primaryDisabled: state.capability.status !== "available"
      || state.operationStatus !== "idle"
      || !layoutVerified
      || (!nextVariant && !readyToCompare && !pendingPromotion && !pendingEstimate),
  };
}
