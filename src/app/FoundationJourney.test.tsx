import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import { DRONE_ARM_FOUNDATION_CONTEXT } from "../samples/drone-arm-foundation";
import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";
import { harness } from "../viewer/field-viewer-test-support";
import { FoundationJourney } from "./FoundationJourney";

const browserCleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  browserCleanups.splice(0).forEach((dispose) => dispose());
});

test("completes the exact prediction-to-evidence journey under human control", async () => {
  const context = new FakeModelContext();
  browserCleanups.push(installFakeModelContext(context));
  const compute = vi.fn(async (input: ProbeInput) => ({
    status: "verified" as const,
    output: new Float32Array(input.values.length).fill(0.7 - compute.mock.calls.length * 0.1),
    elapsedMs: 8 + compute.mock.calls.length,
    relativeL2: 0,
    tolerance: 0.000005,
  }));

  render(
    <FoundationJourney
      capability={{ status: "available", message: "Test adapter acquired." }}
      compute={compute}
      viewerEnvironment={harness().environment}
    />,
  );

  expect(screen.getByRole("heading", { name: /structural evolution/i })).toBeVisible();
  expect(screen.getByText(/webgpu available/i)).toBeVisible();
  expect(screen.getByText(DRONE_ARM_FOUNDATION_STUDY.study.revision)).toBeVisible();
  expect(screen.getAllByText(/motor-side arm span/i)[0]).toBeVisible();
  expect(screen.getByText(/6 preserved mounts/i)).toBeVisible();
  expect(screen.getByText(/compute foundation—not structural optimization/i)).toBeVisible();
  await waitFor(() => expect(context.active.has("inspect_design_context")).toBe(true));
  const initialInspection = await context.execute("inspect_design_context", { scope: "current" }) as {
    content: readonly { text: string }[];
  };
  const initialFacts = JSON.parse(initialInspection.content[0]!.text) as {
    contextRevision: string; context: unknown;
  };
  expect(initialFacts.context).toEqual(DRONE_ARM_FOUNDATION_CONTEXT);
  expect(screen.getByText("assembly · mm")).toBeVisible();
  expect(screen.getByText(/32 × 32 × 32/)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /run baseline verification/i }));
  await waitFor(() => expect(screen.getByText(/verified against the wasm oracle/i)).toBeVisible());
  expect(screen.getByText(/agent prediction/i)).toBeVisible();
  expect(screen.getByText(/measured evidence/i)).toBeVisible();
  expect(screen.getByRole("table", { name: /experiment branches/i })).toBeVisible();
  expect(screen.getAllByText(DRONE_ARM_FOUNDATION_STUDY.study.revision)[0]).toBeVisible();
  expect(screen.getByRole("log", { name: /action receipts/i })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /promote branch/i }));
  await waitFor(() => expect(screen.getByText(/human-promoted configuration/i)).toBeVisible());
  const acceptedRow = screen.getByRole("cell", { name: "Accepted source" }).closest("tr");
  expect(acceptedRow?.querySelectorAll("td")[0]?.textContent).toBe(
    "4612c20b9a1725fd9739d0046eb09c9e748d312c1434be2709ae31046e7f0fd1",
  );
  expect(acceptedRow?.querySelectorAll("td")[1]?.textContent).not.toBe(initialFacts.contextRevision);

  fireEvent.click(screen.getByRole("button", { name: /run edge-biased alternative/i }));
  fireEvent.click(await screen.findByRole("button", { name: /run center-biased alternative/i }));
  await screen.findByRole("button", { name: /alternatives ready to compare/i });

  fireEvent.click(screen.getByRole("button", { name: /compare verified alternatives/i }));
  await waitFor(() => expect(screen.getByText(/measured branch comparison/i)).toBeVisible());
  expect(screen.getByRole("table", { name: /verified branch comparison/i })).toBeVisible();
  expect(screen.getByText(/shared assembly anchor/i)).toBeVisible();
  expect(screen.getByRole("radio", { name: /overlay/i })).toBeVisible();
  expect(screen.getByRole("radio", { name: /peel/i })).toBeVisible();
  expect(screen.getByRole("radio", { name: /audition/i })).toBeVisible();
  const peel = screen.getByRole("radio", { name: /peel/i }) as HTMLInputElement;
  fireEvent.click(peel);
  expect(peel.checked).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: /select [0-9a-f]{64}/i })[0]!);
  const audition = screen.getByRole("radio", { name: /audition/i }) as HTMLInputElement;
  fireEvent.click(audition);
  expect(audition.checked).toBe(true);

  const lock = screen.getByRole("button", { name: /lock cable clearance/i });
  fireEvent.click(lock);
  await waitFor(() => expect(screen.getByText(/prior experiment plan is stale/i)).toBeVisible());
  expect(screen.getAllByRole("button", { name: /promote branch/i }).at(-1)).toBeDisabled();
  expect(screen.getByRole("button", { name: /cable clearance locked/i })).toBeDisabled();
  const changedInspection = await context.execute("inspect_design_context", { scope: "current" }) as {
    content: readonly { text: string }[];
  };
  const changedFacts = JSON.parse(changedInspection.content[0]!.text) as {
    contextRevision: string;
    context: typeof DRONE_ARM_FOUNDATION_CONTEXT;
  };
  expect(changedFacts.contextRevision).not.toBe(initialFacts.contextRevision);
  expect(changedFacts.context).toEqual({
    ...DRONE_ARM_FOUNDATION_CONTEXT,
    selection: expect.objectContaining({ id: "cable-clearance", min: [12, 8, 4], maxExclusive: [26, 20, 26] }),
    locks: ["body-fixed-region", "cable-clearance"],
  });
});

test("recovers from baseline and alternative failures without erasing their evidence", async () => {
  const compute = vi.fn(async (input: ProbeInput) => {
    const call = compute.mock.calls.length;
    if (call === 1) return {
      status: "failed" as const, code: "device-error" as const,
      message: "adapter reset during baseline", elapsedMs: 4,
    };
    if (call === 3) return {
      status: "mismatch" as const, code: "verification-mismatch" as const,
      message: "edge field disagreed with the oracle", elapsedMs: 6,
      relativeL2: 0.2, tolerance: 0.000005,
    };
    return {
      status: "verified" as const,
      output: new Float32Array(input.values.length).fill(0.6),
      elapsedMs: 8, relativeL2: 0, tolerance: 0.000005,
    };
  });
  render(
    <FoundationJourney
      capability={{ status: "available", message: "Test adapter acquired." }}
      compute={compute}
      viewerEnvironment={harness().environment}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /run baseline verification/i }));
  await screen.findByText("adapter reset during baseline");
  fireEvent.click(screen.getByRole("button", { name: /retry baseline verification/i }));
  await screen.findByText(/verified against the wasm oracle/i);
  expect(screen.getByText("Attempt 2")).toBeVisible();
  expect(screen.getAllByText(/adapter reset during baseline/i)).not.toHaveLength(0);

  fireEvent.click(screen.getAllByRole("button", { name: /promote branch/i }).at(-1)!);
  await screen.findByText(/human-promoted configuration/i);
  fireEvent.click(screen.getByRole("button", { name: /run edge-biased alternative/i }));
  await screen.findByText("edge field disagreed with the oracle");
  expect(screen.getByText(/historical verification: baseline/i)).toBeVisible();
  expect(screen.getAllByRole("button", { name: /promote branch/i }).at(-1)).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: /retry edge-biased alternative/i }));
  await screen.findByRole("button", { name: /run center-biased alternative/i });
  expect(compute).toHaveBeenCalledTimes(4);
});

test("shows cancellation as immutable evidence and ignores a late verified result", async () => {
  let resolveProbe!: (result: ProbeResult) => void;
  const compute = vi.fn((_input: ProbeInput, _signal?: AbortSignal) =>
    new Promise<ProbeResult>(
      (resolve) => { resolveProbe = resolve; },
    ));
  render(
    <FoundationJourney
      capability={{ status: "available", message: "Test adapter acquired." }}
      compute={compute}
      viewerEnvironment={harness().environment}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /run baseline verification/i }));
  fireEvent.click(await screen.findByRole("button", { name: /cancel running probe/i }));
  await screen.findByText(/foundation probe canceled by the user/i);
  expect(await screen.findByRole("button", { name: /retry baseline verification/i })).toBeVisible();
  expect(screen.getByRole("log", { name: /action receipts/i }).textContent).toContain("Canceled:");

  resolveProbe({
    status: "verified", output: new Float32Array(32 ** 3).fill(0.7),
    elapsedMs: 9, relativeL2: 0, tolerance: 0.000005,
  });
  await waitFor(() => expect(screen.queryByText(/verified against the wasm oracle/i)).toBeNull());
});

test("forwards WebMCP invocation cancellation to one terminal canceled transaction", async () => {
  const context = new FakeModelContext();
  browserCleanups.push(installFakeModelContext(context));
  const compute = vi.fn((_input: ProbeInput, signal?: AbortSignal) => new Promise<ProbeResult>((resolve) => {
    signal?.addEventListener("abort", () => resolve({
      status: "canceled", code: "canceled", message: "protocol invocation aborted", elapsedMs: 1,
    }), { once: true });
  }));
  render(
    <FoundationJourney
      capability={{ status: "available", message: "Test adapter acquired." }}
      compute={compute}
      viewerEnvironment={harness().environment}
    />,
  );
  await waitFor(() => expect(context.active.has("run_foundation_probe")).toBe(true));
  const controller = new AbortController();
  const invocation = context.execute("run_foundation_probe", {
    parentRevision: DRONE_ARM_FOUNDATION_STUDY.study.revision,
    variant: "baseline",
    hypothesis: "Exercise the deterministic baseline",
    prediction: "Verification stays within the probe budget",
  }, controller.signal) as Promise<{ isError?: boolean; content: readonly { text: string }[] }>;
  await screen.findByRole("button", { name: /cancel running probe/i });
  await waitFor(() => expect(context.active.has("run_foundation_probe")).toBe(false));

  controller.abort();
  expect(context.active.has("run_foundation_probe")).toBe(false);
  const response = await invocation;
  const output = JSON.parse(response.content[0]!.text) as { status?: string };

  expect(response.isError).toBe(true);
  expect(output.status).toBe("canceled");
  expect((await screen.findAllByText(/foundation probe canceled by the invoking client/i)).length).toBeGreaterThan(0);
  const ledger = screen.getByRole("log", { name: /action receipts/i });
  expect(ledger.textContent?.match(/run_foundation_probe/g)).toHaveLength(1);
  expect(ledger.textContent?.match(/cancel_foundation_probe/g)).toHaveLength(1);
  expect(screen.queryByText(/human-promoted configuration/i)).toBeNull();
  await waitFor(() => expect(context.active.has("run_foundation_probe")).toBe(true));
});
