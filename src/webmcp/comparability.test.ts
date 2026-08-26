import { expect, test } from "vitest";

import type { FoundationBranch } from "./schemas";
import { hasComparableBranches } from "./comparability";

const branch = (branchRevision: string, parentRevision: string): FoundationBranch => ({
  branchRevision,
  parentRevision,
  variant: "baseline",
  hypothesis: "Exercise baseline field behavior",
  prediction: "Verification stays within the probe budget",
  stale: false,
  status: "verified",
  measurement: {
    status: "verified",
    elapsedMs: 8,
    relativeL2: 0,
    resultDigest: "d".repeat(64),
  },
});

test("comparison requires two distinct verified branches with one exact parent", () => {
  const first = branch("a".repeat(64), "1".repeat(64));
  const sibling = branch("b".repeat(64), "1".repeat(64));
  const otherParent = branch("c".repeat(64), "2".repeat(64));

  expect(hasComparableBranches([first, otherParent])).toBe(false);
  expect(hasComparableBranches([first, first])).toBe(false);
  expect(hasComparableBranches([first, sibling])).toBe(true);
});
