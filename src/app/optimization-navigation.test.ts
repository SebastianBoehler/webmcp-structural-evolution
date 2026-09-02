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

function estimate(branchRevision: string, stale = false, variant: FoundationBranch["variant"] = "lightweight"): FoundationBranch {
  return {
    parentRevision: revisionA,
    proposalRevision: `${branchRevision}-proposal`,
    branchRevision,
    attempt: 1,
    variant,
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

function verified(branchRevision: string): FoundationBranch {
  return {
    ...estimate(branchRevision, false, "balanced"),
    status: "verified",
    measurement: {
      status: "verified",
      elapsedMs: 8,
      relativeL2: 0,
      resultDigest: "d".repeat(64),
    },
    result: {
      status: "verified",
      output: new Float32Array(8),
      elapsedMs: 8,
      relativeL2: 0,
      tolerance: 0.000005,
    },
  };
}

test("offers the latest non-stale estimate only after runnable verified work is exhausted", () => {
  const latest = estimate("latest");
  const navigation = deriveOptimizationNavigation(
    state(), [estimate("older"), latest, estimate("stale", true)], true, 0, true,
  );

  expect(navigation).toMatchObject({
    pendingEstimate: latest,
    primaryLabel: "Review interactive estimate",
    primaryDisabled: false,
  });
  expect(navigation.nextVariant).toBeUndefined();
  expect(navigation.pendingPromotion).toBeUndefined();
  expect(navigation.readyToCompare).toBe(false);
});

test("keeps runnable variants, verified comparison, and verified promotion ahead of estimate review", () => {
  const runnable = deriveOptimizationNavigation(
    state(), [estimate("balanced-estimate", false, "balanced")], true, 0, true,
  );
  expect(runnable).toMatchObject({ nextVariant: "lightweight", primaryLabel: "Generate lightweight frame" });
  expect(runnable.pendingEstimate).toBeUndefined();

  const comparison = deriveOptimizationNavigation(
    state(), [estimate("comparison-estimate")], true, 2, true,
  );
  expect(comparison).toMatchObject({ readyToCompare: true, primaryLabel: "Compare alternatives" });
  expect(comparison.pendingEstimate).toBeUndefined();

  const promotion = deriveOptimizationNavigation(
    state(), [verified("verified-candidate"), estimate("promotion-estimate")], true, 0, true,
  );
  expect(promotion).toMatchObject({ pendingPromotion: expect.objectContaining({ status: "verified" }), primaryLabel: "Review topology candidate" });
  expect(promotion.pendingEstimate).toBeUndefined();
});
