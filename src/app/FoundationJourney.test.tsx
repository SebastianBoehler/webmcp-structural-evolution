import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ProbeInput } from "../gpu/probe-contract";
import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import { harness } from "../viewer/field-viewer-test-support";
import { FoundationJourney } from "./FoundationJourney";

test("completes the exact prediction-to-evidence journey under human control", async () => {
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

  fireEvent.click(screen.getByRole("button", { name: /run baseline verification/i }));
  await waitFor(() => expect(screen.getByText(/verified against the wasm oracle/i)).toBeVisible());
  expect(screen.getByText(/agent prediction/i)).toBeVisible();
  expect(screen.getByText(/measured evidence/i)).toBeVisible();
  expect(screen.getByRole("table", { name: /experiment branches/i })).toBeVisible();
  expect(screen.getAllByText(DRONE_ARM_FOUNDATION_STUDY.study.revision)[0]).toBeVisible();
  expect(screen.getByRole("log", { name: /action receipts/i })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /promote branch/i }));
  await waitFor(() => expect(screen.getByText(/human-promoted configuration/i)).toBeVisible());

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

  fireEvent.click(screen.getByRole("button", { name: /lock cable clearance/i }));
  await waitFor(() => expect(screen.getByText(/prior experiment plan is stale/i)).toBeVisible());
  expect(screen.getAllByRole("button", { name: /promote branch/i }).at(-1)).toBeDisabled();
});
