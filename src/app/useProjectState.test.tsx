import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StrictMode } from "react";

import type { ProbeInput } from "../gpu/probe-contract";
import type { ProbeResult } from "../gpu/compute-probe";
import { ExperimentRail } from "./ExperimentRail";
import { ReceiptLedger } from "./ReceiptLedger";
import { useProjectState } from "./useProjectState";
import { render, screen } from "@testing-library/react";

const revisionA = "a".repeat(64);
const runInput = {
  parentRevision: revisionA,
  variant: "edge-biased" as const,
  hypothesis: "Exercise the edge-biased field",
  prediction: "Verification stays within the probe budget",
};

test("stages an exact immutable branch and stores prediction before measured output", async () => {
  let resolveProbe!: (result: {
    status: "verified";
    output: Float32Array;
    elapsedMs: number;
    relativeL2: number;
    tolerance: number;
  }) => void;
  const compute = vi.fn((_input: ProbeInput) => new Promise<ProbeResult>(resolve => { resolveProbe = resolve; }));
  const { result } = renderHook(() => useProjectState({
    contextRevision: revisionA,
    acceptedBranchRevision: revisionA,
    selection: { id: "motor-arm", label: "Motor arm" },
    locks: ["body-mount"],
    capability: { status: "available", message: "ready" },
    compute,
  }), { wrapper: StrictMode });

  let running!: Promise<unknown>;
  act(() => { running = result.current.services.runProbe(runInput); });
  await waitFor(() => expect(result.current.state.stagedBranches).toHaveLength(1));
  expect(result.current.state.stagedBranches[0]).toMatchObject({
    parentRevision: revisionA,
    branchRevision: "cd59a9190cb189df21607c85b23a77ee1ae336d8274654d523b75c2fba626334",
    prediction: runInput.prediction,
    status: "running",
  });
  expect(compute.mock.calls[0]?.[0].values).toBeInstanceOf(Float32Array);

  await act(async () => {
    resolveProbe({
      status: "verified",
      output: new Float32Array(32 ** 3).fill(0.5),
      elapsedMs: 14,
      relativeL2: 0,
      tolerance: 0.000005,
    });
    await running;
  });
  expect(result.current.state.stagedBranches[0]).toMatchObject({
    prediction: runInput.prediction,
    measurement: { status: "verified", elapsedMs: 14, relativeL2: 0 },
  });
  expect(result.current.state.receipts.at(-1)).toMatchObject({
    action: "run_foundation_probe",
    affectedRevision: "cd59a9190cb189df21607c85b23a77ee1ae336d8274654d523b75c2fba626334",
    outcome: { status: "succeeded" },
  });
});

test("human intervention marks staged branches stale and only the rail can promote", async () => {
  const compute = vi.fn(async () => ({
    status: "verified" as const,
    output: new Float32Array(32 ** 3).fill(0.25),
    elapsedMs: 7,
    relativeL2: 0,
    tolerance: 0.000005,
  }));
  const { result } = renderHook(() => useProjectState({
    contextRevision: revisionA,
    acceptedBranchRevision: revisionA,
    selection: { id: "motor-arm", label: "Motor arm" },
    locks: ["body-mount"],
    capability: { status: "available", message: "ready" },
    compute,
  }));
  await act(async () => { await result.current.services.runProbe(runInput); });
  const branchRevision = result.current.state.stagedBranches[0]!.branchRevision;

  await act(async () => {
    await result.current.experimentRail.intervene({
      selection: { id: "cable-path", label: "Cable path" },
      locks: ["body-mount", "cable-clearance"],
    });
  });
  expect(result.current.state.stagedBranches[0]?.stale).toBe(true);
  await expect(result.current.experimentRail.promoteBranch(branchRevision)).rejects.toThrow(/stale/i);

  render(
    <>
      <ExperimentRail state={result.current.state} api={result.current.experimentRail} />
      <ReceiptLedger receipts={result.current.state.receipts} />
    </>,
  );
  expect(screen.getByRole("table", { name: /experiment branches/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /promote/i })).toBeDisabled();
  expect(screen.getByRole("log", { name: /action receipts/i })).toBeVisible();
  expect(screen.getByText(/stale/i)).toBeVisible();
  expect(screen.getAllByText(/affected revision/i)).not.toHaveLength(0);
  expect(screen.getAllByText(/validated input/i)).not.toHaveLength(0);
  expect(screen.getAllByText(/result:/i)).not.toHaveLength(0);
});

test("the human rail API promotes a verified exact branch and records its receipt", async () => {
  const compute = vi.fn(async () => ({
    status: "verified" as const,
    output: new Float32Array(32 ** 3).fill(0.75),
    elapsedMs: 6,
    relativeL2: 0,
    tolerance: 0.000005,
  }));
  const { result } = renderHook(() => useProjectState({
    contextRevision: revisionA,
    acceptedBranchRevision: revisionA,
    selection: { id: "motor-arm", label: "Motor arm" },
    locks: ["body-mount"],
    capability: { status: "available", message: "ready" },
    compute,
  }));
  await act(async () => { await result.current.services.runProbe(runInput); });
  const branchRevision = result.current.state.stagedBranches[0]!.branchRevision;

  await act(async () => { await result.current.experimentRail.promoteBranch(branchRevision); });

  expect(result.current.state.acceptedBranchRevision).toBe(branchRevision);
  expect(result.current.state.receipts.at(-1)).toMatchObject({
    action: "promote_branch",
    affectedRevision: branchRevision,
    outcome: { status: "succeeded" },
  });
});

test("a mismatched branch strips any unexpected renderable output", async () => {
  const compute = vi.fn(async () => ({
    status: "mismatch" as const,
    code: "verification-mismatch" as const,
    message: "Measured field disagreed with the oracle",
    elapsedMs: 5,
    relativeL2: 0.1,
    tolerance: 0.000005,
    output: new Float32Array(32 ** 3).fill(1),
  }));
  const { result } = renderHook(() => useProjectState({
    contextRevision: revisionA,
    acceptedBranchRevision: revisionA,
    selection: { id: "motor-arm", label: "Motor arm" },
    locks: ["body-mount"],
    capability: { status: "available", message: "ready" },
    compute,
  }));

  await act(async () => { await result.current.services.runProbe(runInput); });

  expect(result.current.state.stagedBranches[0]?.status).toBe("mismatch");
  expect(result.current.state.stagedBranches[0]?.result).not.toHaveProperty("output");
});
