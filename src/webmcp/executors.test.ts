import { expect, test, vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import { testFoundationContext } from "../test/foundation-context";
import {
  compareFoundationProbes,
  inspectDesignContext,
  runFoundationProbe,
  type FoundationServices,
} from "./executors";

const revisionA = "a".repeat(64);
const revisionB = "b".repeat(64);

function responseJson(response: Awaited<ReturnType<typeof inspectDesignContext>>) {
  const text = response.content[0]?.text;
  if (!text) throw new Error("Expected a text tool response");
  expect(text.length).toBeLessThanOrEqual(1500);
  return JSON.parse(text) as Record<string, unknown>;
}

function services(overrides: Partial<FoundationServices> = {}): FoundationServices {
  return {
    inspectContext: vi.fn(async () => ({
      contextRevision: revisionA,
      context: testFoundationContext(),
      selection: { id: "motor-arm", label: "Motor arm" },
      locks: ["body-mount"],
      acceptedBranchRevision: revisionA,
      stagedBranches: [],
      stagedBranchCount: 0,
      omittedBranchCount: 0,
      capability: { status: "available" as const, message: "ready" },
      stale: false as const,
      nextActions: ["generate_topology_candidate"],
    })),
    runProbe: vi.fn(async () => ({
      parentRevision: revisionA,
      proposalRevision: revisionB,
      branchRevision: revisionB,
      attempt: 1,
      hypothesis: "Exercise the lightweight field",
      prediction: "Verification stays within the probe budget",
      variant: "lightweight" as const,
      stale: false as const,
      status: "verified" as const,
      measurement: {
        status: "verified" as const,
        elapsedMs: 12,
        relativeL2: 0,
        resultDigest: "c".repeat(64),
      },
    })),
    compareProbes: vi.fn(async () => ({
      parentRevision: revisionA,
      leftRevision: revisionB,
      rightRevision: "c".repeat(64),
      leftStatus: "verified" as const,
      rightStatus: "verified" as const,
      timingDeltaMs: 4,
      relativeL2Delta: 0.000001,
      leftDigest: "d".repeat(64),
      rightDigest: "e".repeat(64),
      stale: false as const,
      nextActions: ["inspect_design_context"],
    })),
    canCompare: vi.fn(() => false),
    cancelProbe: vi.fn(async () => { throw new Error("not running"); }),
    recordRejectedCall: vi.fn(async () => undefined),
    ...overrides,
  };
}

test("inspect validates exact scope and returns context facts without provenance", async () => {
  const shared = services();
  const response = await inspectDesignContext({ scope: "current" }, shared);
  const facts = responseJson(response);

  expect(response.isError).not.toBe(true);
  expect(facts).toMatchObject({
    contextRevision: revisionA,
    selection: { id: "motor-arm", label: "Motor arm" },
    locks: ["body-mount"],
    capability: { status: "available" },
    nextActions: ["generate_topology_candidate"],
  });
  expect(JSON.stringify(facts)).not.toMatch(/provenance|manufacturer|reference/i);
  expect(shared.inspectContext).toHaveBeenCalledWith({ scope: "current" });
});

test("run validates bounded intent and delegates only the deterministic variant", async () => {
  const runProbe = vi.fn(async (input) => ({
    ...input,
    proposalRevision: revisionB,
    branchRevision: revisionB,
    attempt: 1,
    stale: false,
    status: "verified" as const,
    measurement: {
      status: "verified" as const,
      elapsedMs: 9,
      relativeL2: 0,
      resultDigest: "f".repeat(64),
    },
  }));
  const shared = services({ runProbe });
  const input = {
    parentRevision: revisionA,
    variant: "lightweight",
    hypothesis: "Exercise the lightweight field",
    prediction: "Verification stays within the probe budget",
  } as const;

  const response = await runFoundationProbe(input, shared);
  const facts = responseJson(response);

  expect(runProbe).toHaveBeenCalledWith(input, undefined);
  expect(facts).toMatchObject({
    parentRevision: revisionA,
    proposalRevision: revisionB,
    attempt: 1,
    hypothesis: input.hypothesis,
    prediction: input.prediction,
    measurement: { status: "verified", elapsedMs: 9, relativeL2: 0 },
  });
  expect((facts.measurement as Record<string, unknown>).prediction).toBeUndefined();
  expect(facts.nextActions).toEqual(["inspect_design_context"]);
});

test("run advertises comparison only when the latest state has an exact comparable pair", async () => {
  const shared = services({ canCompare: vi.fn(() => true) });
  const response = await runFoundationProbe({
    parentRevision: revisionA,
    variant: "balanced",
    hypothesis: "Check the shipped probe",
    prediction: "Verification stays within the probe budget",
  }, shared);

  expect(responseJson(response).nextActions).toEqual([
    "inspect_design_context",
    "compare_topology_candidates",
  ]);
});

test("run returns an interactive estimate as reviewable evidence, not a tool error", async () => {
  const shared = services({
    canCompare: vi.fn(() => true),
    runProbe: vi.fn(async () => ({
      parentRevision: revisionA,
      proposalRevision: revisionB,
      branchRevision: revisionB,
      attempt: 1,
      hypothesis: "Check the shipped probe",
      prediction: "Verification stays within the probe budget",
      variant: "balanced" as const,
      stale: false as const,
      status: "estimate" as const,
      measurement: {
        status: "estimate" as const,
        elapsedMs: 12,
        relativeL2: 0,
        resultDigest: "c".repeat(64),
        code: "interactive-estimate",
        message: "Legacy Wasm topology is an interactive estimate only",
      },
      result: {
        status: "estimate" as const,
        truthLevel: "interactive-estimate" as const,
        output: new Float32Array(8),
        elapsedMs: 12,
        relativeL2: 0,
        tolerance: 0.000005,
      },
    })),
  });

  const response = await runFoundationProbe({
    parentRevision: revisionA,
    variant: "balanced",
    hypothesis: "Check the shipped probe",
    prediction: "Verification stays within the probe budget",
  }, shared);
  const facts = responseJson(response);

  expect(response.isError).not.toBe(true);
  expect(facts).toMatchObject({
    status: "estimate",
    measurement: {
      status: "estimate",
      code: "interactive-estimate",
      message: "Legacy Wasm topology is an interactive estimate only",
    },
  });
  expect(facts.nextActions).toEqual(["inspect_design_context"]);
});

test.each(["failed", "mismatch", "canceled"] as const)(
  "run returns %s as an explicit non-success tool outcome",
  async (status) => {
    const base = await services().runProbe({
      parentRevision: revisionA,
      variant: "balanced",
      hypothesis: "Check the shipped probe",
      prediction: "Verification stays within the probe budget",
    });
    const shared = services({ runProbe: vi.fn(async () => ({ ...base, status })) });

    const response = await runFoundationProbe({
      parentRevision: revisionA,
      variant: "balanced",
      hypothesis: "Check the shipped probe",
      prediction: "Verification stays within the probe budget",
    }, shared);

    expect(response.isError).toBe(true);
    expect(responseJson(response)).toMatchObject({ status, proposalRevision: revisionB, attempt: 1 });
  },
);

test("stale verified completion does not advertise unavailable comparison", async () => {
  const shared = services({
    runProbe: vi.fn(async () => ({
      parentRevision: revisionA,
      proposalRevision: revisionB,
      branchRevision: revisionB,
      attempt: 1,
      hypothesis: "Check the shipped probe",
      prediction: "Verification stays within the probe budget",
      variant: "balanced" as const,
      stale: true as const,
      status: "verified" as const,
      measurement: {
        status: "verified" as const,
        elapsedMs: 12,
        relativeL2: 0,
        resultDigest: "c".repeat(64),
      },
    })),
  });
  const response = await runFoundationProbe({
    parentRevision: revisionA,
    variant: "balanced",
    hypothesis: "Check the shipped probe",
    prediction: "Verification stays within the probe budget",
  }, shared);

  expect(responseJson(response).nextActions).toEqual(["inspect_design_context"]);
});

test("run accepts bounded structural predictions for topology optimization", async () => {
  const shared = services();
  const response = await runFoundationProbe({
    parentRevision: revisionA,
    variant: "balanced",
    hypothesis: "Check the shipped probe",
    prediction: "This will reduce structural mass",
  }, shared);

  expect(response.isError).toBeUndefined();
  expect(shared.runProbe).toHaveBeenCalledOnce();
  expect(shared.recordRejectedCall).not.toHaveBeenCalled();
});

test("run rejects HTML, URLs, file paths, and code-shaped intent text", async () => {
  const shared = services();
  const unsafe = ["<script>probe()</script>", "https://example.test", "/tmp/probe", "value => value"];

  for (const hypothesis of unsafe) {
    const response = await runFoundationProbe({
      parentRevision: revisionA,
      variant: "balanced",
      hypothesis,
      prediction: "Verification stays within the probe budget",
    }, shared);
    expect(response.isError).toBe(true);
  }
  expect(shared.runProbe).not.toHaveBeenCalled();
});

test("compare accepts two exact distinct revisions and returns measured deltas", async () => {
  const shared = services();
  const response = await compareFoundationProbes({
    leftRevision: revisionB,
    rightRevision: "c".repeat(64),
  }, shared);
  const facts = responseJson(response);

  expect(facts).toMatchObject({
    parentRevision: revisionA,
    leftStatus: "verified",
    rightStatus: "verified",
    timingDeltaMs: 4,
    relativeL2Delta: 0.000001,
  });
  expect(shared.compareProbes).toHaveBeenCalledOnce();
});

test("mismatch results cannot carry renderable output through the service contract", () => {
  const mismatch: ProbeResult = {
    status: "mismatch",
    code: "verification-mismatch",
    message: "different",
    elapsedMs: 3,
    relativeL2: 0.1,
    tolerance: 0.000005,
  };

  expect("output" in mismatch).toBe(false);
});
