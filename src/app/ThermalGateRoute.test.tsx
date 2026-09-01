import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";
import type { ThermalBrowserGateSession } from "../solver/thermal/browser-thermal-gate";
import { ThermalGateRoute } from "./ThermalGateRoute";

const passed = { report: {
  status: "passed", reportDigest: "a".repeat(64), evidenceSource: "live-browser-webgpu-wasm",
  recordedAt: "2026-09-01T00:00:00.000Z", sourceRevision: "b".repeat(64),
  studyId: "se6-upper-arm-thermal", device: { vendor: "apple", architecture: "metal-3" },
  grid: { cellDimensions: [42, 8, 8], activeCellCount: 2688 },
  boundaries: { mountingAreaM2: .0064, motorAreaM2: .0064, heatInputW: 80 },
  solve: { iterations: 40, relativeResidual: 1e-8, relativeEnergyImbalance: 1e-6,
    minimumTemperatureK: 300, maximumTemperatureK: 331 },
  verification: { temperatureRelativeL2: 1e-6, fieldRelativeL2: 1e-6,
    heatRateRelativeError: 1e-6, relativeEnergyImbalance: 1e-6 },
  cancellation: { outcome: "cancelled", terminalCount: 1, artifactsCommitted: 0,
    recoveryRunPassed: true },
  artifacts: [], timingsMs: { build: 1, solve: 2, total: 3 },
}, model: { modelId: "se6-upper-arm-housing", authority: "parametric-specification-model",
  sourceRevision: "b".repeat(64), componentCount: 1, bodyCount: 1, state: "verified" } } as unknown as ThermalBrowserGateSession;

afterEach(cleanup);

test("UI and WebMCP execute the same live thermal session service", async () => {
  const context = new FakeModelContext();
  const dispose = installFakeModelContext(context);
  const runGate = vi.fn(async () => passed);
  const view = render(<ThermalGateRoute runGate={runGate} />);
  await screen.findByText(/live thermal solve evidence passed/i);
  expect(screen.getByText("se6-upper-arm-housing")).toBeVisible();
  expect(screen.getByText(/parametric-specification-model/i)).toBeVisible();
  expect(screen.queryByText(/^live thermal gate passed\.$/i)).toBeNull();
  await waitFor(() => expect(context.active.has("run_cobot_thermal_study")).toBe(true));

  fireEvent.click(screen.getByRole("button", { name: /run gate again/i }));
  await waitFor(() => expect(runGate).toHaveBeenCalledTimes(2));
  const response = await context.execute("run_cobot_thermal_study", {}) as {
    isError?: boolean; content: readonly { text: string }[];
  };

  expect(response.isError).toBeUndefined();
  expect(runGate).toHaveBeenCalledTimes(3);
  expect(response.content[0]?.text).toContain(passed.report.reportDigest);
  expect(response.content[0]?.text).toContain("se6-upper-arm-housing");
  expect(response.content[0]?.text).toContain("parametric-specification-model");
  view.unmount();
  dispose();
});

test("cancel aborts the UI run and recovery remains restartable", async () => {
  const runGate = vi.fn((signal: AbortSignal) => new Promise<ThermalBrowserGateSession>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  render(<ThermalGateRoute runGate={runGate} />);
  fireEvent.click(await screen.findByRole("button", { name: /cancel live run/i }));
  expect(await screen.findByText(/cancelled.*no result artifact/i)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /run gate again/i }));
  expect(runGate).toHaveBeenCalledTimes(2);
});
