import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { initialDroneWorkspace } from "../assembly/drone-workspace";
import {
  DRONE_ARM_FOUNDATION_CONTEXT,
  DRONE_ARM_FOUNDATION_STUDY,
} from "../samples/drone-arm-foundation";
import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";
import { harness } from "../viewer/field-viewer-test-support";
import { FoundationJourney } from "./FoundationJourney";

const browserCleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  browserCleanups.splice(0).forEach((dispose) => dispose());
});

function renderJourney(compute: (input: ProbeInput, signal?: AbortSignal) => Promise<ProbeResult>) {
  return render(
    <FoundationJourney
      capability={{ status: "available", message: "Test adapter acquired." }}
      compute={compute}
      viewerEnvironment={harness().environment}
    />,
  );
}

test("completes the exact prediction-to-evidence journey in the CAD workbench", async () => {
  const context = new FakeModelContext();
  browserCleanups.push(installFakeModelContext(context));
  const compute = vi.fn(async (input: ProbeInput) => ({
    status: "verified" as const,
    output: new Float32Array(input.values.length).fill(0.7 - compute.mock.calls.length * 0.1),
    elapsedMs: 8 + compute.mock.calls.length,
    relativeL2: 0,
    tolerance: 0.000005,
  }));
  renderJourney(compute);

  expect(screen.getByRole("heading", { name: /structural evolution/i })).toBeVisible();
  expect(screen.getByText(/webgpu available/i)).toBeVisible();
  expect(screen.getByRole("searchbox", { name: /find a component/i })).toBeVisible();
  expect(screen.getByRole("img", { name: /interactive 3d drone-arm assembly/i })).toBeVisible();
  const stage = screen.getByRole("main").querySelector(".workbench-stage")!;
  fireEvent.click(screen.getByRole("button", { name: /hide assembly/i }));
  expect(stage.getAttribute("data-components-collapsed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /show assembly/i }));
  expect(stage.getAttribute("data-components-collapsed")).toBe("false");
  const canvasLayout = screen.getByRole("main").querySelector(".viewport-canvas")!;
  fireEvent.click(screen.getByRole("button", { name: /^analysis$/i }));
  expect(canvasLayout.getAttribute("data-analysis-open")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /^analysis$/i }));
  expect(canvasLayout.getAttribute("data-analysis-open")).toBe("true");
  expect(screen.getByText(/drop a trusted local zip package, step, stp, glb, or gltf/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /import component file/i })).toBeVisible();
  expect(screen.getByText(/^east motor$/i)).toBeVisible();
  expect(screen.getByText(/128 × 128 × 32/)).toBeVisible();
  fireEvent.click(screen.getByText("Engineering details"));
  expect(screen.getByText("assembly · mm")).toBeVisible();

  await waitFor(() => expect(context.active.has("inspect_design_context")).toBe(true));
  const initialInspection = await context.execute("inspect_design_context", { scope: "current" }) as {
    content: readonly { text: string }[];
  };
  const initialFacts = JSON.parse(initialInspection.content[0]!.text) as {
    contextRevision: string; context: unknown;
  };
  expect(initialFacts.context).toEqual(DRONE_ARM_FOUNDATION_CONTEXT);

  fireEvent.click(screen.getByRole("button", { name: /^evidence$/i }));
  fireEvent.click(screen.getByRole("button", { name: /generate balanced frame/i }));
  await waitFor(() => expect(screen.getByText(/candidate completed its output checks/i)).toBeVisible());
  expect(screen.getByText(/agent prediction/i)).toBeVisible();
  expect(screen.getByText(/measured evidence/i)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /review topology candidate/i }));
  expect(screen.getByRole("list", { name: /experiment branches/i })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /use this frame/i }));
  fireEvent.click(screen.getByRole("button", { name: /^evidence$/i }));
  await waitFor(() => expect(screen.getByText(/human-promoted configuration/i)).toBeVisible());

  fireEvent.click(screen.getByRole("button", { name: /generate lightweight frame/i }));
  fireEvent.click(await screen.findByRole("button", { name: /generate stiffness-first frame/i }));
  fireEvent.click(await screen.findByRole("button", { name: /compare alternatives/i }));
  await waitFor(() => expect(screen.getByText(/measured branch comparison/i)).toBeVisible());

  const peel = screen.getByRole("button", { name: /^peel$/i });
  fireEvent.click(peel);
  expect(peel.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /alternative 1/i }));
  const audition = screen.getByRole("button", { name: /^audition$/i });
  fireEvent.click(audition);
  expect(audition.getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: /protect route/i }));
  await waitFor(() => expect(screen.getByText(/prior experiment plan is stale/i)).toBeVisible());
  expect(screen.getByRole("button", { name: /route protected/i })).toBeDisabled();
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
    selection: expect.objectContaining({
      id: "cable-clearance", min: [3, 11, 2], maxExclusive: [22, 14, 5],
    }),
    locks: ["body-fixed-region", "cable-clearance"],
  });
});

test("recovers from failures without erasing their evidence", async () => {
  const compute = vi.fn(async (input: ProbeInput) => {
    const call = compute.mock.calls.length;
    if (call === 1) return {
      status: "failed" as const, code: "device-error" as const,
      message: "adapter reset during balanced", elapsedMs: 4,
    };
    if (call === 3) return {
      status: "mismatch" as const, code: "verification-mismatch" as const,
      message: "lightweight frame failed output checks", elapsedMs: 6,
      relativeL2: 0.2, tolerance: 0.000005,
    };
    return {
      status: "verified" as const,
      output: new Float32Array(input.values.length).fill(0.6),
      elapsedMs: 8, relativeL2: 0, tolerance: 0.000005,
    };
  });
  renderJourney(compute);
  fireEvent.click(screen.getByRole("button", { name: /^evidence$/i }));

  fireEvent.click(screen.getByRole("button", { name: /generate balanced frame/i }));
  await screen.findByText("adapter reset during balanced");
  fireEvent.click(screen.getByRole("button", { name: /retry balanced frame/i }));
  await screen.findByText(/candidate completed its output checks/i);
  fireEvent.click(screen.getByRole("button", { name: /review topology candidate/i }));
  expect(screen.getByText("Attempt 2")).toBeVisible();
  fireEvent.click(screen.getAllByRole("button", { name: /use this frame/i }).at(-1)!);
  await screen.findByRole("button", { name: /generate lightweight frame/i });
  fireEvent.click(screen.getByRole("button", { name: /^evidence$/i }));
  fireEvent.click(screen.getByRole("button", { name: /generate lightweight frame/i }));
  expect((await screen.findAllByText("lightweight frame failed output checks")).length).toBeGreaterThan(0);
  expect(screen.getByText(/historical verification: balanced/i)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /retry lightweight frame/i }));
  await screen.findByRole("button", { name: /generate stiffness-first frame/i });
  expect(compute).toHaveBeenCalledTimes(4);
});

test("shows cancellation as immutable evidence and ignores a late result", async () => {
  let resolveProbe!: (result: ProbeResult) => void;
  const compute = vi.fn((_input: ProbeInput, _signal?: AbortSignal) =>
    new Promise<ProbeResult>((resolve) => { resolveProbe = resolve; }));
  renderJourney(compute);
  fireEvent.click(screen.getByRole("button", { name: /^evidence$/i }));

  fireEvent.click(screen.getByRole("button", { name: /generate balanced frame/i }));
  fireEvent.click(await screen.findByRole("button", { name: /cancel optimization/i }));
  await screen.findByText(/topology optimization canceled by the user/i);
  expect(await screen.findByRole("button", { name: /retry balanced frame/i })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^history/i }));
  expect(screen.getByRole("log", { name: /action receipts/i }).textContent).toContain("Canceled");

  resolveProbe({
    status: "verified", output: new Float32Array(32 ** 3).fill(0.7),
    elapsedMs: 9, relativeL2: 0, tolerance: 0.000005,
  });
  await waitFor(() => expect(screen.queryByText(/candidate completed its output checks/i)).toBeNull());
});

test("forwards WebMCP cancellation to one terminal transaction", async () => {
  const context = new FakeModelContext();
  browserCleanups.push(installFakeModelContext(context));
  const compute = vi.fn((_input: ProbeInput, signal?: AbortSignal) => new Promise<ProbeResult>((resolve) => {
    signal?.addEventListener("abort", () => resolve({
      status: "canceled", code: "canceled", message: "protocol invocation aborted", elapsedMs: 1,
    }), { once: true });
  }));
  renderJourney(compute);
  await waitFor(() => expect(context.active.has("generate_topology_candidate")).toBe(true));
  const controller = new AbortController();
  const invocation = context.execute("generate_topology_candidate", {
    parentRevision: initialDroneWorkspace.revision,
    variant: "balanced",
    hypothesis: "Exercise the deterministic balanced",
    prediction: "Verification stays within the probe budget",
  }, controller.signal) as Promise<{ isError?: boolean; content: readonly { text: string }[] }>;
  await screen.findByRole("button", { name: /cancel optimization/i });
  await waitFor(() => expect(context.active.has("generate_topology_candidate")).toBe(false));

  controller.abort();
  const response = await invocation;
  const output = JSON.parse(response.content[0]!.text) as { status?: string };
  expect(response.isError).toBe(true);
  expect(output.status).toBe("canceled");

  fireEvent.click(screen.getByRole("button", { name: /^evidence$/i }));
  expect((await screen.findAllByText(/topology optimization canceled by the invoking client/i)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /^history/i }));
  const ledger = screen.getByRole("log", { name: /action receipts/i });
  expect(ledger.textContent?.match(/generate_topology_candidate/g)).toHaveLength(1);
  expect(ledger.textContent?.match(/cancel_topology_optimization/g)).toHaveLength(1);
  await waitFor(() => expect(context.active.has("generate_topology_candidate")).toBe(true));
});
