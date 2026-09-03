import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { ProbeInput } from "../gpu/probe-contract";
import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";
import { FoundationJourney } from "./FoundationJourney";

const responseFacts = (response: unknown) => JSON.parse(
  (response as { content: readonly { text: string }[] }).content[0]!.text,
) as Record<string, unknown>;

afterEach(cleanup);

test("an agent reviews successive candidate cases through the live Simulate dashboard", async () => {
  const context = new FakeModelContext();
  const dispose = installFakeModelContext(context);
  const compute = async (input: ProbeInput) => {
    const field = new Float32Array(input.values.length).fill(0.5);
    return {
      status: "estimate" as const,
      truthLevel: "interactive-estimate" as const,
      output: field,
      elapsedMs: 12,
      relativeL2: 0,
      tolerance: 0,
      topology: {
        solver: "sparse-simp-lattice-wasm" as const,
        initialCompliance: 4, finalCompliance: 2, maxDisplacement: 0.004,
        maxStress: 16_000_000, minimumSafetyFactor: 3, materialFraction: 0.5, iterations: 12,
      },
      analysis: {
        displacement: field, stress: field,
        cases: Object.fromEntries([
          "collective-thrust", "roll-differential", "pitch-differential", "yaw-torsion",
        ].map((id, index) => [id, {
          displacement: new Float32Array(input.values.length).fill((index + 1) / 1_000),
          displacementVectorsM: new Float32Array(input.values.length * 3)
            .fill((index + 1) / 1_000),
          stress: new Float32Array(input.values.length).fill((index + 1) * 4_000_000),
        }])),
      },
    };
  };
  render(<FoundationJourney capability={{ status: "available", message: "ready" }} compute={compute} />);

  await waitFor(() => expect(context.active.has("inspect_design_context")).toBe(true));
  const inspection = responseFacts(await context.execute("inspect_design_context", { scope: "current" }));
  const generated = responseFacts(await context.execute("generate_topology_candidate", {
    parentRevision: inspection.contextRevision,
    variant: "balanced",
    hypothesis: "Explore a connected frame candidate",
    prediction: "The bounded field completes within the browser budget",
  }));
  await waitFor(() => expect(context.active.has("review_topology_case")).toBe(true));
  const branchRevision = generated.branchRevision as string;

  let pitch!: Record<string, unknown>;
  await act(async () => {
    pitch = responseFacts(await context.execute("review_topology_case", {
      branchRevision,
      caseId: "pitch",
      display: "displacement",
      geometry: "frame-only",
    }));
  });

  expect(pitch).toMatchObject({ status: "displayed", structuralCase: "pitch-differential" });
  expect(screen.getByRole("heading", { name: "Simulate" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Displacement" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Frame only" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Pause flight replay" })).toBeVisible();
  expect(screen.getByText("Pitch brake")).toBeVisible();
  expect(screen.getByText("3.00 mm")).toBeVisible();
  expect(screen.getByText("1000× visual")).toBeVisible();

  await act(async () => {
    await context.execute("review_topology_case", {
      branchRevision,
      caseId: "yaw",
      display: "stress",
      geometry: "full-assembly",
    });
  });
  expect(screen.getByRole("button", { name: "Yaw burst" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Stress" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Full assembly" }).getAttribute("aria-pressed")).toBe("true");
  dispose();
}, 20_000);
