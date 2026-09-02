import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { initialDroneWorkspace } from "../assembly/drone-workspace";
import { DEMO_FIXTURES } from "../samples/demo-fixtures";
import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";
import { harness } from "../viewer/field-viewer-test-support";
import { FoundationJourney } from "./FoundationJourney";

const browserCleanups: Array<() => void> = [];
const sparseField = (input: ProbeInput, density: number) => {
  const output = new Float32Array(input.values.length);
  for (let index = 0; index < Math.min(output.length, 64); index += 8) output[index] = density;
  return output;
};
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

test("reveals only controls that belong to the current engineering step", () => {
  renderJourney(async (input) => ({
    status: "verified",
    output: sparseField(input, 0.7),
    elapsedMs: 8,
    relativeL2: 0,
    tolerance: 0.000005,
  }));

  expect(screen.getByRole("button", { name: /^parts$/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /^details$/i })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^density$/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /^evidence$/i })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));
  expect(screen.getByRole("button", { name: /generate balanced frame/i })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^parts$/i })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /^simulate$/i }));
  expect(screen.getByRole("button", { name: /run flight replay/i })).toBeDisabled();
  expect(screen.getByText(/generate a verified topology before replaying flight loads/i)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /^review$/i }));
  expect(screen.getByRole("button", { name: /^evidence$/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /^agents$/i })).toBeVisible();
  expect(screen.queryByRole("button", { name: /run flight replay/i })).toBeNull();
});

test("completes the exact prediction-to-evidence journey in the CAD workbench", async () => {
  const context = new FakeModelContext();
  browserCleanups.push(installFakeModelContext(context));
  const compute = vi.fn(async (input: ProbeInput) => ({
    status: "verified" as const,
    output: sparseField(input, 0.7 - compute.mock.calls.length * 0.1),
    elapsedMs: 8 + compute.mock.calls.length,
    relativeL2: 0,
    tolerance: 0.000005,
  }));
  renderJourney(compute);

  expect(screen.getByRole("heading", { name: /structural evolution/i })).toBeVisible();
  expect(screen.getByText(/compute available/i)).toBeVisible();
  expect(screen.getByRole("searchbox", { name: /find a component/i })).toBeVisible();
  expect(screen.getByRole("img", { name: /interactive 3d physical assembly/i })).toBeVisible();
  expect(screen.getByText(/drop a trusted local zip package, step, stp, glb, or gltf/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /import component file/i })).toBeVisible();
  expect(screen.getByText(/^east motor$/i)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^details$/i }));
  expect(screen.getByText(/128 × 128 × 16/)).toBeVisible();
  fireEvent.click(screen.getByText("Engineering details"));
  expect(screen.getByText("assembly · mm")).toBeVisible();

  await waitFor(() => expect(context.active.has("inspect_design_context")).toBe(true));
  const initialInspection = await context.execute("inspect_design_context", { scope: "current" }) as {
    content: readonly { text: string }[];
  };
  const initialFacts = JSON.parse(initialInspection.content[0]!.text) as {
    contextRevision: string; context: unknown;
  };
  expect(initialFacts.context).toEqual(DEMO_FIXTURES["reference-drone"].context);

  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));
  fireEvent.click(screen.getByRole("button", { name: /generate balanced frame/i }));
  await screen.findByRole("button", { name: /review topology candidate/i });

  fireEvent.click(screen.getByRole("button", { name: /review topology candidate/i }));
  expect(screen.getByRole("list", { name: /experiment branches/i })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /use this frame/i }));
  fireEvent.click(screen.getByRole("button", { name: /^evidence$/i }));
  await waitFor(() => expect(screen.getByText(/human-promoted configuration/i)).toBeVisible());
  expect(screen.getByText(/agent prediction/i)).toBeVisible();
  expect(screen.getByText(/measured evidence/i)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));
  fireEvent.click(screen.getByRole("button", { name: /generate lightweight frame/i }));
  fireEvent.click(await screen.findByRole("button", { name: /generate stiffness-first frame/i }, { timeout: 15_000 }));
  fireEvent.click(await screen.findByRole("button", { name: /compare alternatives/i }, { timeout: 15_000 }));
  await waitFor(() => expect(screen.getByText(/measured branch comparison/i)).toBeVisible());

  const peel = screen.getByRole("button", { name: /^peel$/i });
  fireEvent.click(peel);
  expect(peel.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /alternative 1/i }));
  const audition = screen.getByRole("button", { name: /^inspect one$/i });
  fireEvent.click(audition);
  expect(audition.getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: /^assemble$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^details$/i }));
  fireEvent.click(screen.getByRole("button", { name: /protect route/i }));
  fireEvent.click(screen.getByRole("button", { name: /^review$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^evidence$/i }));
  await waitFor(() => expect(screen.getByText(/prior experiment plan is stale/i)).toBeVisible());
  const changedInspection = await context.execute("inspect_design_context", { scope: "current" }) as {
    content: readonly { text: string }[];
  };
  const changedFacts = JSON.parse(changedInspection.content[0]!.text) as {
    contextRevision: string;
    context: typeof DEMO_FIXTURES["reference-drone"]["context"];
  };
  expect(changedFacts.contextRevision).not.toBe(initialFacts.contextRevision);
  expect(changedFacts.context).toEqual({
    ...DEMO_FIXTURES["reference-drone"].context,
    selection: expect.objectContaining({
      id: "cable-clearance", min: [3, 11, 2], maxExclusive: [22, 14, 5],
    }),
    locks: ["body-fixed-region", "cable-clearance"],
  });
}, 60_000);

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
      output: sparseField(input, 0.6),
      elapsedMs: 8, relativeL2: 0, tolerance: 0.000005,
    };
  });
  renderJourney(compute);
  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));

  fireEvent.click(screen.getByRole("button", { name: /generate balanced frame/i }));
  await screen.findByText("adapter reset during balanced");
  fireEvent.click(screen.getByRole("button", { name: /retry balanced frame/i }));
  await screen.findByText(/candidate completed its output checks/i);
  fireEvent.click(screen.getByRole("button", { name: /review topology candidate/i }));
  expect(screen.getByText("Attempt 2")).toBeVisible();
  fireEvent.click(screen.getAllByRole("button", { name: /use this frame/i }).at(-1)!);
  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));
  fireEvent.click(await screen.findByRole("button", { name: /generate lightweight frame/i }));
  expect((await screen.findAllByText("lightweight frame failed output checks", {}, { timeout: 5_000 })).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /^review$/i }));
  expect(screen.getByText(/historical verification: balanced/i)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));
  fireEvent.click(screen.getByRole("button", { name: /retry lightweight frame/i }));
  await screen.findByRole("button", { name: /generate stiffness-first frame/i }, { timeout: 15_000 });
  expect(compute).toHaveBeenCalledTimes(4);
}, 30_000);

test("reviews an interactive estimate without rendering it as an accepted topology", async () => {
  renderJourney(async (input) => ({
    status: "estimate",
    truthLevel: "interactive-estimate",
    output: sparseField(input, 0.5),
    elapsedMs: 8,
    relativeL2: 0,
    tolerance: 0.000005,
    topology: {
      solver: "sparse-simp-lattice-wasm",
      initialCompliance: 4,
      finalCompliance: 2,
      maxDisplacement: 0.001,
      maxStress: 10,
      minimumSafetyFactor: 2,
      materialFraction: 0.5,
      iterations: 4,
    },
  }));
  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));
  fireEvent.click(screen.getByRole("button", { name: /generate balanced frame/i }));
  fireEvent.click(await screen.findByRole("button", { name: /review interactive estimate/i }));

  const branches = screen.getByRole("list", { name: /experiment branches/i });
  expect(within(branches).getByText("50.0%")).toBeVisible();
  expect(within(branches).getByText("2.000")).toBeVisible();
  expect(within(branches).getByRole("button", { name: /use this frame/i })).toBeDisabled();
  expect(screen.queryByRole("group", { name: /candidate comparison/i })).toBeNull();
  expect(screen.queryByLabelText("Topology result")).toBeNull();
});

test("shows cancellation as immutable evidence and ignores a late result", async () => {
  let resolveProbe!: (result: ProbeResult) => void;
  const compute = vi.fn((_input: ProbeInput, _signal?: AbortSignal) =>
    new Promise<ProbeResult>((resolve) => { resolveProbe = resolve; }));
  renderJourney(compute);
  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));

  fireEvent.click(screen.getByRole("button", { name: /generate balanced frame/i }));
  expect(await screen.findByText(/gray center: fixed assembly interface/i)).toBeVisible();
  fireEvent.click(await screen.findByRole("button", { name: /cancel optimization/i }));
  await screen.findByText(/topology optimization canceled by the user/i);
  expect(await screen.findByRole("button", { name: /retry balanced frame/i })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^review$/i }));
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

  fireEvent.click(screen.getByRole("button", { name: /^review$/i }));
  fireEvent.click(screen.getByRole("button", { name: /^evidence$/i }));
  expect((await screen.findAllByText(/topology optimization canceled by the invoking client/i)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /^history/i }));
  const ledger = screen.getByRole("log", { name: /action receipts/i });
  expect(ledger.textContent?.match(/generate_topology_candidate/g)).toHaveLength(1);
  expect(ledger.textContent?.match(/cancel_topology_optimization/g)).toHaveLength(1);
  await waitFor(() => expect(context.active.has("generate_topology_candidate")).toBe(true));
});

test("solves the SE-6 upper arm with its named load cases and no flight-only claims", async () => {
  const compute = vi.fn(async (input: ProbeInput): Promise<ProbeResult> => ({
    status: "verified",
    output: sparseField(input, 0.65),
    elapsedMs: 6,
    relativeL2: 0,
    tolerance: 0,
  }));
  render(<FoundationJourney
    capability={{ status: "available", message: "Test adapter acquired." }}
    compute={compute}
    fixtureId="se6-cobot"
    onFixtureChange={vi.fn()}
    viewerEnvironment={harness().environment}
  />);

  expect(screen.getByText("Mounted 1.5 kg calibration payload")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));
  fireEvent.click(screen.getByRole("button", { name: /generate balanced upper arm/i }));
  await screen.findByRole("button", { name: /review topology candidate/i });

  const solverInput = compute.mock.calls[0]![0].assembly!;
  expect(solverInput.loadCases.map(({ id }) => id)).toEqual([
    "rated-payload-gravity", "emergency-stop", "lateral-disturbance",
  ]);
  expect(solverInput.motorMounts).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: /^simulate$/i }));
  expect(screen.getByText(/flight replay does not apply to this assembly/i)).toBeVisible();
  expect(screen.getByText("rated-payload-gravity")).toBeVisible();
  expect(screen.getByText("emergency-stop")).toBeVisible();
  expect(screen.getByText("lateral-disturbance")).toBeVisible();
});
