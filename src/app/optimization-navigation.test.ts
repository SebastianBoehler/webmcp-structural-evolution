import { expect, test } from "vitest";

import type { FoundationBranch, FoundationProjectState } from "../webmcp/schemas";
import { testFoundationContext } from "../test/foundation-context";
import { deriveOptimizationNavigation } from "./optimization-navigation";

const revisionA = "a".repeat(64);

function state(): FoundationProjectState {
  const context = testFoundationContext();
  return {
    contextRevision: revisionA,
    context,
    selection: context.selection,
    locks: context.locks,
    acceptedBranchRevision: revisionA,
    stagedBranches: [],
    capability: { status: "available", message: "ready" },
    operationStatus: "idle",
    receipts: [],
  };
}

function estimate(branchRevision: string, stale = false): FoundationBranch {
  return {
    parentRevision: revisionA,
    proposalRevision: `${branchRevision}-proposal`,
    branchRevision,
    attempt: 1,
    variant: "lightweight",
    hypothesis: "Exercise the lightweight field",
    prediction: "Verification stays within the probe budget",
    stale,
    status: "estimate",
    measurement: {
      status: "estimate",
      elapsedMs: 8,
      relativeL2: 0,
      resultDigest: "c".repeat(64),
      code: "interactive-estimate",
      message: "Legacy Wasm topology is an interactive estimate only",
    },
    result: {
      status: "estimate",
      truthLevel: "interactive-estimate",
      output: new Float32Array(8),
      elapsedMs: 8,
      relativeL2: 0,
      tolerance: 0.000005,
    },
  };
}

test("offers the latest non-stale estimate only after runnable verified work is exhausted", () => {
  const reviewable = estimate("reviewable");
  const navigation = deriveOptimizationNavigation(
    state(), [reviewable, estimate("stale", true)], true, 0, true,
  );

  expect(navigation).toMatchObject({
    pendingEstimate: reviewable,
    primaryLabel: "Review interactive estimate",
    primaryDisabled: false,
  });
  expect(navigation.nextVariant).toBeUndefined();
  expect(navigation.pendingPromotion).toBeUndefined();
  expect(navigation.readyToCompare).toBe(false);
});
