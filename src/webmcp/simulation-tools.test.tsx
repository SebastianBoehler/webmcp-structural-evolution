import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FoundationBranch } from "./schemas";
import {
  SimulationAgentTools,
  simulationToolDefinitions,
  type SimulationViewCommand,
} from "./simulation-tools";
import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";

const parentRevision = "a".repeat(64);
const branchRevision = "b".repeat(64);
const field = (values: readonly number[]) => Float32Array.from(values);

function candidate(): FoundationBranch {
  return {
    parentRevision,
    proposalRevision: "c".repeat(64),
    branchRevision,
    attempt: 1,
    variant: "balanced",
    hypothesis: "Explore a connected frame candidate",
    prediction: "The bounded field completes within the browser budget",
    stale: false,
    status: "estimate",
    measurement: { status: "estimate", elapsedMs: 15, relativeL2: 0, resultDigest: "d".repeat(64) },
    result: {
      status: "estimate",
      truthLevel: "interactive-estimate",
      output: field([0.7, 0.8]),
      elapsedMs: 15,
      relativeL2: 0,
      tolerance: 0,
      topology: {
        solver: "sparse-simp-lattice-wasm",
        initialCompliance: 4,
        finalCompliance: 2,
        maxDisplacement: 0.004,
        maxStress: 30_000_000,
        minimumSafetyFactor: 1.67,
        materialFraction: 0.5,
        iterations: 12,
      },
      analysis: {
        displacement: field([0.003, 0.004]),
        stress: field([20_000_000, 30_000_000]),
        cases: {
          "collective-thrust": { displacement: field([0.001, 0.002]), stress: field([8_000_000, 9_000_000]) },
          "roll-differential": { displacement: field([0.002, 0.003]), stress: field([10_000_000, 12_000_000]) },
          "pitch-differential": { displacement: field([0.003, 0.004]), stress: field([14_000_000, 16_000_000]) },
          "yaw-torsion": { displacement: field([0.001, 0.0015]), stress: field([6_000_000, 7_000_000]) },
        },
      },
    },
  };
}

const motors = [
  { id: "motor-east", centerM: [0.105, 0, 0] as const },
  { id: "motor-north", centerM: [0, 0.105, 0] as const },
  { id: "motor-west", centerM: [-0.105, 0, 0] as const },
  { id: "motor-south", centerM: [0, -0.105, 0] as const },
];

const output = (response: { content: readonly { text: string }[] }) =>
  JSON.parse(response.content[0]!.text) as Record<string, unknown>;

describe("simulation WebMCP tools", () => {
  afterEach(cleanup);

  it("reviews one exact named candidate case, updates the live view, and returns bounded truthful metrics", async () => {
    const onViewCommand = vi.fn<(command: SimulationViewCommand) => void>();
    const [tool] = simulationToolDefinitions({
      candidate: candidate(),
      contextRevision: parentRevision,
      motors,
      massKg: 0.515,
      onViewCommand,
      presentationHoldMs: 0,
    });

    const response = await tool.execute({
      branchRevision,
      caseId: "pitch",
      display: "displacement",
      geometry: "frame-only",
    });

    expect(tool.name).toBe("review_topology_case");
    expect(tool.annotations.readOnlyHint).toBe(false);
    expect(onViewCommand).toHaveBeenCalledWith({
      scenario: "pitch",
      analysisLayer: "displacement",
      componentsVisible: false,
    });
    const facts = output(response);
    expect(facts).toMatchObject({
      status: "displayed",
      branchRevision,
      caseId: "pitch",
      structuralCase: "pitch-differential",
      display: "displacement",
      geometry: "frame-only",
      candidateTruth: "interactive-estimate",
      structuralEstimate: {
        maximumAxialStressPa: 16_000_000,
      },
      humanDecision: {
        verified: false,
        accepted: false,
        nextAction: "human_review",
      },
    });
    expect((facts.structuralEstimate as { maximumDisplacementM: number }).maximumDisplacementM)
      .toBeCloseTo(0.004);
    expect(JSON.stringify(facts)).toMatch(/not verified continuum fea/i);
  });

  it("registers on the flight assembly before generation and reads the latest candidate at call time", async () => {
    const context = new FakeModelContext();
    const dispose = installFakeModelContext(context);
    const view = render(<SimulationAgentTools
      contextRevision={parentRevision}
      motors={motors}
      massKg={0.515}
      onViewCommand={vi.fn()}
    />);

    await waitFor(() => expect(context.active.has("review_topology_case")).toBe(true));
    expect(screen.getByText(/1 of 1 simulation review tools registered/i)).toBeVisible();
    expect((await context.execute("review_topology_case", {
      branchRevision, caseId: "hover", display: "loads", geometry: "full-assembly",
    }) as { isError?: boolean }).isError).toBe(true);
    view.rerender(<SimulationAgentTools candidate={candidate()} contextRevision={parentRevision}
      motors={motors} massKg={0.515} onViewCommand={vi.fn()} presentationHoldMs={0} />);
    expect((await context.execute("review_topology_case", {
      branchRevision, caseId: "hover", display: "loads", geometry: "full-assembly",
    }) as { isError?: boolean }).isError).not.toBe(true);
    dispose();
  });

  it("rejects a stale candidate revision without changing the dashboard", async () => {
    const onViewCommand = vi.fn();
    const [tool] = simulationToolDefinitions({
      candidate: candidate(), contextRevision: parentRevision, motors, massKg: 0.515, onViewCommand,
      presentationHoldMs: 0,
    });
    const response = await tool.execute({
      branchRevision: "e".repeat(64), caseId: "roll", display: "stress", geometry: "full-assembly",
    });

    expect(response.isError).toBe(true);
    expect(JSON.stringify(output(response))).toMatch(/exact visible candidate revision/i);
    expect(onViewCommand).not.toHaveBeenCalled();
  });
});
