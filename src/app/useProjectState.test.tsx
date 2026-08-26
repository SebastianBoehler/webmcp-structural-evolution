import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StrictMode } from "react";

import type { ProbeInput } from "../gpu/probe-contract";
import type { ProbeResult } from "../gpu/compute-probe";
import { ExperimentRail } from "./ExperimentRail";
import { ReceiptLedger } from "./ReceiptLedger";
import { useProjectState } from "./useProjectState";
import { render, screen } from "@testing-library/react";
import { testFoundationContext } from "../test/foundation-context";

const revisionA = "a".repeat(64);
const selection = (id: string, label: string) => testFoundationContext({ id, label }).selection;
const runInput = {
  parentRevision: revisionA,
  variant: "lightweight" as const,
  hypothesis: "Exercise the lightweight field",
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
    context: testFoundationContext(),
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
    proposalRevision: "e34790e81a295367d269e08807a56ded5c0a0b303ead6284831d138212cd1e8d",
    branchRevision: "46b46dd6e6037f1e798d0322d48cc47f44c78a46ad98f82d71b1ab1ce72834d2",
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
    action: "generate_topology_candidate",
    affectedRevision: "46b46dd6e6037f1e798d0322d48cc47f44c78a46ad98f82d71b1ab1ce72834d2",
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
    context: testFoundationContext(),
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
      selection: selection("cable-path", "Cable path"),
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
  expect(screen.getByRole("list", { name: /experiment branches/i })).toBeVisible();
  expect(screen.getByText("Attempt 1")).toBeVisible();
  expect(screen.getAllByText(result.current.state.stagedBranches[0]!.proposalRevision).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /use this frame/i })).toBeDisabled();
  expect(screen.getByRole("log", { name: /action receipts/i })).toBeVisible();
  expect(screen.getByText(/stale/i)).toBeVisible();
  expect(screen.getAllByText(/affected revision/i)).not.toHaveLength(0);
  expect(screen.getAllByText(/validated input/i)).not.toHaveLength(0);
  expect(screen.getAllByText(/^result$/i)).not.toHaveLength(0);
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
    context: testFoundationContext(),
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
    context: testFoundationContext(),
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
