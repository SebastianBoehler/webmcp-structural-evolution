import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { foundationToolDefinitions } from "../webmcp/register-tools";
import { useProjectState } from "./useProjectState";

const revisionA = "a".repeat(64);
const baseInput = {
  parentRevision: revisionA,
  variant: "edge-biased" as const,
  hypothesis: "Exercise the edge-biased field",
  prediction: "Verification stays within the probe budget",
};
const verified = (value = 0.5): ProbeResult => ({
  status: "verified",
  output: new Float32Array(32 ** 3).fill(value),
  elapsedMs: 8,
  relativeL2: 0,
  tolerance: 0.000005,
});

function options(compute: (input: ProbeInput) => Promise<ProbeResult>) {
  return {
    contextRevision: revisionA,
    acceptedBranchRevision: revisionA,
    selection: { id: "motor-arm", label: "Motor arm" },
    locks: ["body-mount"],
    capability: { status: "available" as const, message: "ready" },
    compute,
  };
}

test("intervention during compute keeps the completed branch stale and unpromotable", async () => {
  let resolveProbe!: (result: ProbeResult) => void;
  const compute = vi.fn(() => new Promise<ProbeResult>((resolve) => { resolveProbe = resolve; }));
  const { result } = renderHook(() => useProjectState(options(compute)));

  let running!: Promise<unknown>;
  act(() => { running = result.current.services.runProbe(baseInput); });
  await waitFor(() => expect(result.current.state.stagedBranches[0]?.status).toBe("running"));
  await act(async () => {
    await result.current.experimentRail.intervene({
      selection: { id: "cable-path", label: "Cable path" },
      locks: ["body-mount", "cable-clearance"],
    });
  });

  await act(async () => {
    resolveProbe(verified());
    await running;
  });

  const branch = result.current.state.stagedBranches[0]!;
  expect(branch).toMatchObject({ status: "verified", stale: true });
  expect(result.current.state.locks).toEqual(["body-mount", "cable-clearance"]);
  await expect(result.current.experimentRail.promoteBranch(branch.branchRevision)).rejects.toThrow(/stale/i);
});

test("intervention that completes during promotion is never overwritten", async () => {
  const compute = vi.fn(async () => verified());
  const { result } = renderHook(() => useProjectState(options(compute)));
  await act(async () => { await result.current.services.runProbe(baseInput); });
  const branchRevision = result.current.state.stagedBranches[0]!.branchRevision;
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  let releasePromotion!: () => void;
  const promotionGate = new Promise<void>((resolve) => { releasePromotion = resolve; });
  let digestCalls = 0;
  const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
    digestCalls += 1;
    if (digestCalls === 1) await promotionGate;
    return originalDigest(algorithm, data);
  });

  const promoting = result.current.experimentRail.promoteBranch(branchRevision);
  await waitFor(() => expect(digestCalls).toBe(1));
  await act(async () => {
    await result.current.experimentRail.intervene({
      selection: { id: "cable-path", label: "Cable path" },
      locks: ["body-mount", "cable-clearance"],
    });
  });
  releasePromotion();
  await expect(promoting).rejects.toThrow(/changed|stale/i);

  expect(result.current.state.acceptedBranchRevision).toBe(revisionA);
  expect(result.current.state.selection.id).toBe("cable-path");
  expect(result.current.state.locks).toEqual(["body-mount", "cable-clearance"]);
  digestSpy.mockRestore();
});

test("simultaneous run calls reserve one operation before asynchronous hashing", async () => {
  const resolvers: Array<(result: ProbeResult) => void> = [];
  const compute = vi.fn(() => new Promise<ProbeResult>((resolve) => { resolvers.push(resolve); }));
  const { result } = renderHook(() => useProjectState(options(compute)));
  const alternate = {
    ...baseInput,
    variant: "center-biased" as const,
    hypothesis: "Exercise the center-biased field",
  };

  const first = result.current.services.runProbe(baseInput);
  const second = result.current.services.runProbe(alternate).then(
    () => "resolved",
    (error: unknown) => error instanceof Error ? error.message : String(error),
  );
  await waitFor(() => expect(compute).toHaveBeenCalledTimes(1));
  expect(await second).toMatch(/already running/i);

  await act(async () => {
    resolvers[0]!(verified());
    await first;
  });
  expect(result.current.state.stagedBranches).toHaveLength(1);
  expect(result.current.state.operationStatus).toBe("idle");
});

test("identical branch identity is rejected and never enables comparison", async () => {
  const compute = vi.fn(async () => verified());
  const { result } = renderHook(() => useProjectState(options(compute)));
  await act(async () => { await result.current.services.runProbe(baseInput); });

  await expect(result.current.services.runProbe(baseInput)).rejects.toThrow(/already staged/i);

  expect(result.current.state.stagedBranches).toHaveLength(1);
  const definitions = foundationToolDefinitions(result.current.services, result.current.state);
  expect(definitions[2].enabled).toBe(false);
  const facts = await result.current.services.inspectContext({ scope: "current" });
  expect(facts.nextActions).not.toContain("compare_foundation_probes");
});

test.each(["older-first", "newer-first"] as const)(
  "newer intervention wins when hashes complete %s",
  async (completionOrder) => {
    const { result } = renderHook(() => useProjectState(options(vi.fn(async () => verified()))));
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    const releases: Array<() => void> = [];
    const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
      if (releases.length >= 2) return originalDigest(algorithm, data);
      const index = releases.length;
      await new Promise<void>((resolve) => { releases[index] = resolve; });
      return originalDigest(algorithm, data);
    });
    const olderInput = {
      selection: { id: "older-selection", label: "Older selection" },
      locks: ["older-lock"],
    };
    const newerInput = {
      selection: { id: "newer-selection", label: "Newer selection" },
      locks: ["newer-lock"],
    };

    const older = result.current.experimentRail.intervene(olderInput).then(
      () => "resolved",
      (error: unknown) => error instanceof Error ? error.message : String(error),
    );
    const newer = result.current.experimentRail.intervene(newerInput);
    await waitFor(() => expect(releases).toHaveLength(2));

    await act(async () => {
      if (completionOrder === "older-first") {
        releases[0]!();
        expect(await older).toMatch(/superseded/i);
        releases[1]!();
      } else {
        releases[1]!();
        await newer;
        releases[0]!();
      }
      await Promise.all([older, newer]);
    });

    expect(await older).toMatch(/superseded/i);
    expect(result.current.state.selection).toEqual(newerInput.selection);
    expect(result.current.state.locks).toEqual(newerInput.locks);
    digestSpy.mockRestore();
  },
);
