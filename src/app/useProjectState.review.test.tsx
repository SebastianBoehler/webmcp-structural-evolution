import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import { inspectDesignContext } from "../webmcp/executors";
import { useProjectState, type ProjectStateOptions } from "./useProjectState";

const revisionA = "a".repeat(64);
const verified = (value: number): ProbeResult => ({
  status: "verified",
  output: new Float32Array(32 ** 3).fill(value),
  elapsedMs: value * 10,
  relativeL2: 0,
  tolerance: 0.000005,
});
const runInput = (variant: "baseline" | "edge-biased" | "center-biased", label: string) => ({
  parentRevision: revisionA,
  variant,
  hypothesis: `Exercise ${label} field behavior`,
  prediction: "Verification stays within the probe timing budget",
});

function availableOptions(
  compute: ProjectStateOptions["compute"] = vi.fn(async () => verified(0.5)),
): ProjectStateOptions {
  return {
    contextRevision: revisionA,
    acceptedBranchRevision: revisionA,
    selection: { id: "motor-arm", label: "Motor arm" },
    locks: ["body-mount"],
    capability: { status: "available", message: "ready" },
    compute,
  };
}

test("capability changes after detection update state and tool eligibility", async () => {
  const compute = vi.fn(async () => verified(0.5));
  let capability: ProjectStateOptions["capability"] = {
    status: "unavailable",
    code: "api-unavailable",
    message: "not detected",
  };
  const { result, rerender } = renderHook(() => useProjectState({
    ...availableOptions(compute),
    capability,
  }));
  expect(result.current.state.capability.status).toBe("unavailable");

  capability = { status: "available", message: "ready" };
  rerender();

  await waitFor(() => expect(result.current.state.capability.status).toBe("available"));
  await act(async () => { await result.current.services.runProbe(runInput("baseline", "baseline")); });
  expect(compute).toHaveBeenCalledOnce();
});

test("bounded inspect succeeds with many branches and records the same outcome", async () => {
  const compute = vi.fn(async (_input) => verified((compute.mock.calls.length + 1) / 10));
  const { result } = renderHook(() => useProjectState(availableOptions(compute)));
  await act(async () => {
    await result.current.services.runProbe(runInput("baseline", "baseline"));
    await result.current.services.runProbe(runInput("edge-biased", "edge-biased"));
    await result.current.services.runProbe(runInput("center-biased", "center-biased"));
  });

  let response!: Awaited<ReturnType<typeof inspectDesignContext>>;
  await act(async () => {
    response = await inspectDesignContext({ scope: "current" }, result.current.services);
  });
  const text = response.content[0]?.text ?? "";
  const facts = JSON.parse(text) as { stagedBranches: unknown[]; stagedBranchCount: number; omittedBranchCount: number };

  expect(response.isError).not.toBe(true);
  expect(text.length).toBeLessThanOrEqual(1500);
  expect(facts).toMatchObject({ stagedBranchCount: 3, omittedBranchCount: 1 });
  expect(facts.stagedBranches).toHaveLength(2);
  expect(result.current.state.receipts.at(-1)?.outcome.status).toBe("succeeded");
});

test("mutating an exposed verified field cannot alter authoritative evidence", async () => {
  const compute = vi.fn(async () => verified(0.25));
  const { result } = renderHook(() => useProjectState(availableOptions(compute)));
  await act(async () => { await result.current.services.runProbe(runInput("baseline", "baseline")); });
  const branch = result.current.state.stagedBranches[0]!;
  if (branch.result?.status !== "verified") throw new Error("Expected verified branch");
  const digest = branch.measurement!.resultDigest;
  branch.result.output[0] = 99;
  expect(branch.result.output[0]).toBe(0.25);

  await act(async () => { await result.current.services.inspectContext({ scope: "current" }); });
  const republished = result.current.state.stagedBranches[0]!;
  if (republished.result?.status !== "verified") throw new Error("Expected verified branch");
  expect(republished.result.output[0]).toBe(0.25);
  expect(republished.measurement?.resultDigest).toBe(digest);
});
