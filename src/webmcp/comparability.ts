import type { FoundationBranch } from "./schemas";

export function comparableBranchPair(
  branches: readonly FoundationBranch[],
): readonly [FoundationBranch, FoundationBranch] | undefined {
  const byParent = new Map<string, Map<string, FoundationBranch>>();
  for (const branch of branches) {
    if (branch.status !== "verified" || branch.stale) continue;
    const siblings = byParent.get(branch.parentRevision) ?? new Map<string, FoundationBranch>();
    siblings.set(branch.branchRevision, branch);
    byParent.set(branch.parentRevision, siblings);
  }
  for (const siblings of byParent.values()) {
    const distinct = [...siblings.values()];
    if (distinct.length >= 2) return [distinct[0]!, distinct[1]!];
  }
  return undefined;
}

export const hasComparableBranches = (branches: readonly FoundationBranch[]): boolean =>
  comparableBranchPair(branches) !== undefined;
