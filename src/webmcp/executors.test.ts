import { expect, test, vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
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
      selection: { id: "motor-arm", label: "Motor arm" },
      locks: ["body-mount"],
      acceptedBranchRevision: revisionA,
      stagedBranches: [],
      capability: { status: "available" as const, message: "ready" },
      stale: false as const,
      nextActions: ["run_foundation_probe"],
    })),
    runProbe: vi.fn(async () => ({
      parentRevision: revisionA,
      branchRevision: revisionB,
      hypothesis: "Exercise the edge-biased field",
      prediction: "Verification stays within the probe budget",
      variant: "edge-biased" as const,
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
    nextActions: ["run_foundation_probe"],
  });
  expect(JSON.stringify(facts)).not.toMatch(/provenance|manufacturer|reference/i);
  expect(shared.inspectContext).toHaveBeenCalledWith({ scope: "current" });
});

test("run validates bounded intent and delegates only the deterministic variant", async () => {
  const runProbe = vi.fn(async (input) => ({
    ...input,
    branchRevision: revisionB,
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
    variant: "edge-biased",
    hypothesis: "Exercise the edge-biased field",
    prediction: "Verification stays within the probe budget",
  } as const;

  const response = await runFoundationProbe(input, shared);
  const facts = responseJson(response);

  expect(runProbe).toHaveBeenCalledWith(input);
  expect(facts).toMatchObject({
    parentRevision: revisionA,
    hypothesis: input.hypothesis,
    prediction: input.prediction,
    measurement: { status: "verified", elapsedMs: 9, relativeL2: 0 },
  });
  expect((facts.measurement as Record<string, unknown>).prediction).toBeUndefined();
});

test("run rejects structural predictions and records a bounded failed receipt", async () => {
  const shared = services();
  const response = await runFoundationProbe({
    parentRevision: revisionA,
    variant: "baseline",
    hypothesis: "Check the shipped probe",
    prediction: "This will reduce structural mass",
  }, shared);

  expect(response.isError).toBe(true);
  expect(shared.runProbe).not.toHaveBeenCalled();
  expect(shared.recordRejectedCall).toHaveBeenCalledWith(
    "run_foundation_probe",
    revisionA,
    expect.stringMatching(/prediction/i),
  );
});

test("run rejects HTML, URLs, file paths, and code-shaped intent text", async () => {
  const shared = services();
  const unsafe = ["<script>probe()</script>", "https://example.test", "/tmp/probe", "value => value"];

  for (const hypothesis of unsafe) {
    const response = await runFoundationProbe({
      parentRevision: revisionA,
      variant: "baseline",
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
