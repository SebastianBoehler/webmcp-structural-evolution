import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import { inspectDesignContext } from "../webmcp/executors";
import { testFoundationContext } from "../test/foundation-context";
import { useProjectState, type ProjectStateOptions } from "./useProjectState";

const revisionA = "a".repeat(64);
const selection = (id: string, label: string) => testFoundationContext({ id, label }).selection;
const verified = (value: number): ProbeResult => ({
  status: "verified",
  output: new Float32Array(32 ** 3).fill(value),
  elapsedMs: value * 10,
  relativeL2: 0,
  tolerance: 0.000005,
});
const runInput = (variant: "balanced" | "lightweight" | "stiffness", label: string) => ({
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
    context: testFoundationContext(),
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
  await act(async () => { await result.current.services.runProbe(runInput("balanced", "balanced")); });
  expect(compute).toHaveBeenCalledOnce();
});

test("bounded inspect succeeds with many branches and records the same outcome", async () => {
  const compute = vi.fn(async (_input) => verified((compute.mock.calls.length + 1) / 10));
  const { result } = renderHook(() => useProjectState(availableOptions(compute)));
  await act(async () => {
    await result.current.services.runProbe(runInput("balanced", "balanced"));
    await result.current.services.runProbe(runInput("lightweight", "lightweight"));
    await result.current.services.runProbe(runInput("stiffness", "stiffness"));
  });

  let response!: Awaited<ReturnType<typeof inspectDesignContext>>;
  await act(async () => {
    response = await inspectDesignContext({ scope: "current" }, result.current.services);
  });
  const text = response.content[0]?.text ?? "";
  const facts = JSON.parse(text) as { stagedBranches: unknown[]; stagedBranchCount: number; omittedBranchCount: number };

  expect(response.isError).not.toBe(true);
  expect(text.length).toBeLessThanOrEqual(1500);
  expect(facts).toMatchObject({ stagedBranchCount: 3, omittedBranchCount: 2 });
  expect(facts.stagedBranches).toHaveLength(1);
  expect(facts.stagedBranches[0]).toMatchObject({
    proposalRevision: expect.stringMatching(/^[0-9a-f]{64}$/), attempt: 1,
  });
  expect(result.current.state.receipts.at(-1)?.outcome.status).toBe("succeeded");
});

test("mutating an exposed verified field cannot alter authoritative evidence", async () => {
  const compute = vi.fn(async () => verified(0.25));
  const { result } = renderHook(() => useProjectState(availableOptions(compute)));
  await act(async () => { await result.current.services.runProbe(runInput("balanced", "balanced")); });
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

test("typed-array callback methods never receive authoritative evidence", async () => {
  const compute = vi.fn(async () => verified(0.25));
  const { result } = renderHook(() => useProjectState(availableOptions(compute)));
  await act(async () => { await result.current.services.runProbe(runInput("balanced", "balanced")); });
  const branch = result.current.state.stagedBranches[0]!;
  if (branch.result?.status !== "verified") throw new Error("Expected verified branch");
  const output = branch.result.output;

  output.forEach((_value, _index, array) => { array[0] = 91; });
  output.map((_value, index, array) => {
    if (index === 0) array[0] = 92;
    return 1;
  });
  output.reduce((sum, value, index, array) => {
    if (index === 0) array[0] = 93;
    return sum + value;
  }, 0);

  await act(async () => { await result.current.services.inspectContext({ scope: "current" }); });
  const republished = result.current.state.stagedBranches[0]!;
  if (republished.result?.status !== "verified") throw new Error("Expected verified branch");
  expect(republished.result.output[0]).toBe(0.25);
});

test("keeps failed evidence immutable while a later exact retry succeeds", async () => {
  const compute = vi.fn(async () => compute.mock.calls.length === 1
    ? {
        status: "failed" as const, code: "device-error" as const,
        message: "temporary adapter reset", elapsedMs: 4,
      }
    : verified(0.6));
  const { result } = renderHook(() => useProjectState(availableOptions(compute)));

  await act(async () => { await result.current.services.runProbe(runInput("balanced", "balanced")); });
  const failedRevision = result.current.state.stagedBranches[0]!.branchRevision;
  const proposalRevision = result.current.state.stagedBranches[0]!.proposalRevision;
  await act(async () => { await result.current.services.runProbe(runInput("balanced", "balanced")); });

  expect(result.current.state.stagedBranches).toHaveLength(2);
  expect(result.current.state.stagedBranches[0]).toMatchObject({
    branchRevision: failedRevision, status: "failed", measurement: { message: "temporary adapter reset" },
  });
  expect(result.current.state.stagedBranches[1]).toMatchObject({ status: "verified" });
  expect(result.current.state.stagedBranches[1]!.branchRevision).not.toBe(failedRevision);
  expect(result.current.state.stagedBranches.map((branch) => ({
    proposalRevision: branch.proposalRevision, attempt: branch.attempt,
  }))).toEqual([
    { proposalRevision, attempt: 1 },
    { proposalRevision, attempt: 2 },
  ]);
  expect(result.current.state.receipts.filter((receipt) => receipt.action === "generate_topology_candidate")
    .map((receipt) => receipt.validatedInputs)).toEqual([
    expect.objectContaining({ proposalRevision, attempt: 1 }),
    expect.objectContaining({ proposalRevision, attempt: 2 }),
  ]);
});

test("normalizes lock ids and makes a repeated equivalent intervention a no-op", async () => {
  const { result } = renderHook(() => useProjectState(availableOptions()));
  await act(async () => { await result.current.services.runProbe(runInput("balanced", "balanced")); });
  const intervention = {
    selection: selection("cable-path", "Cable path"),
    locks: ["cable-clearance", "body-mount", "cable-clearance"],
  };

  await act(async () => { await result.current.experimentRail.intervene({
    ...intervention, locks: ["body-mount", "cable-clearance"],
  }); });
  const contextRevision = result.current.state.contextRevision;
  expect(result.current.state.locks).toEqual(["body-mount", "cable-clearance"]);

  await act(async () => { await result.current.experimentRail.intervene(intervention); });
  expect(result.current.state.contextRevision).toBe(contextRevision);
  expect(result.current.state.locks).toEqual(["body-mount", "cable-clearance"]);
});

test("post-intervention inspection stays within the tool output budget", async () => {
  const compute = vi.fn(async () => ({
    ...verified(0.5),
    elapsedMs: 25.439999997615814 + compute.mock.calls.length,
    relativeL2: compute.mock.calls.length === 1
      ? 3.7204763714271394e-8
      : 2.8865247969633856e-8,
  }));
  const { result } = renderHook(() => useProjectState({
    ...availableOptions(compute),
    selection: { id: "motor-side-arm-span", label: "Motor-side arm span" },
    locks: ["body-fixed-region"],
    capability: { status: "available", message: "WebGPU adapter and device acquisition succeeded." },
  }));
  await act(async () => {
    await result.current.services.runProbe({
      parentRevision: revisionA, variant: "balanced",
      hypothesis: "Establish the deterministic reference field",
      prediction: "Verification should pass with zero L2 mismatch",
    });
    await result.current.services.runProbe({
      parentRevision: revisionA, variant: "lightweight",
      hypothesis: "Exercise the lightweight input distribution",
      prediction: "Verification should pass within the timing budget",
    });
    await result.current.experimentRail.intervene({
      selection: selection("cable-clearance", "Cable clearance corridor"),
      locks: ["body-fixed-region", "cable-clearance"],
    });
  });

  const response = await inspectDesignContext({ scope: "current" }, result.current.services);
  expect(response.isError).not.toBe(true);
  const text = response.content[0]?.text;
  if (!text) throw new Error("Expected inspection text");
  expect(text.length).toBeLessThanOrEqual(1500);
  expect(JSON.parse(text)).toMatchObject({
    stale: true, stagedBranchCount: 2, omittedBranchCount: 2, stagedBranches: [],
  });
});
