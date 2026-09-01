import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../viewer/FieldViewer", () => ({
  FieldViewer: ({ assemblyPoseParts }: { assemblyPoseParts: readonly { center: readonly number[] }[] }) =>
    <output data-testid="mechanism-viewport" data-x={assemblyPoseParts[0]?.center[0]}/>,
}));

import type { MechanismBrowserGateSession } from "../simulation/browser-mechanism-gate";
import { MechanismGateRoute } from "./MechanismGateRoute";

const body = (positionM: [number, number, number]) => ({ bodyId: "axis-1", positionM,
  orientation: [0, 0, 0, 1] as [number, number, number, number],
  linearVelocityMps: [0, 0, 0] as [number, number, number],
  angularVelocityRadS: [0, 0, 0] as [number, number, number] });
const session = { report: { status: "passed", benchmark: { revoluteJointCount: 6,
  fixedBodyIds: ["base"], frameCount: 2, outputHz: 60 },
  motion: { movingJointIds: ["joint-2", "joint-3", "joint-5"],
    maximumJointDeltaFromAuthoredPoseRad: { "joint-2": .1, "joint-3": .2, "joint-5": .3 },
    maximumJointErrorM: 1e-7 },
  collision: { maximumPenetrationM: 0, minimumRequestedClearanceM: .02, clearanceSampleCount: 2 },
  cancellation: { artifactsCommitted: 0 }, runtime: { runtimeVersion: "Rapier/Wasm" },
  solverPhaseConsole: { statusLines: ["solver passed"], warningCount: 0, errorCount: 0 },
  timingsMs: { total: 10 } },
  model: { modelId: "se6-mechanism-components", authority: "parametric-specification-model",
    sourceRevision: "c".repeat(64), componentCount: 52, bodyCount: 52, state: "verified" },
  benchmark: { visualParts: [{ id: "link", selectionId: "link", label: "link", kind: "box",
    size: [10, 10, 10], center: [0, 0, 0], appearance: "component" }],
    partBodyIds: { link: "axis-1" } },
  input: { colliders: [{ id: "collider", bodyId: "axis-1",
    bodyLocalTransform: { positionM: [0, 0, 0], orientation: [0, 0, 0, 1] } }] },
  result: { replay: { frames: [
    { stepIndex: 0, bodies: [body([0, 0, 0])], joints: [] },
    { stepIndex: 4, bodies: [body([.1, 0, 0])], joints: [] },
  ], clearanceSamples: [], contacts: [] } },
} as unknown as MechanismBrowserGateSession;

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("mechanism gate route", () => {
  it("pauses the mounted cobot pose and synchronized overlay frame", async () => {
    vi.useFakeTimers();
    render(<MechanismGateRoute runGate={async () => session}/>);
    await act(async () => {});
    expect(screen.getByRole("heading", { name: /six-axis cobot mechanism gate/i })).toBeVisible();
    expect(screen.getByText("se6-mechanism-components")).toBeVisible();
    expect(screen.getByText(/52 components · 52 bodies/i)).toBeVisible();
    act(() => vi.advanceTimersByTime(20));
    expect(screen.getByTestId("mechanism-viewport").getAttribute("data-x")).toBe("100");
    const frame = screen.getByTestId("mechanism-frame").textContent;

    fireEvent.click(screen.getByRole("button", { name: /pause replay/i }));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByTestId("mechanism-frame").textContent).toBe(frame);
    expect(screen.getByTestId("mechanism-viewport").getAttribute("data-x")).toBe("100");
    expect(screen.getByRole("button", { name: /resume replay/i })).toBeVisible();
    expect(screen.getByText("Solver phase console")).toBeVisible();
    expect(screen.getByText(/browser UI console is measured independently after mount/i)).toBeVisible();
  });

  it("aborts the active owner on rerun and unmount", async () => {
    const signals: AbortSignal[] = [];
    const runGate = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<MechanismBrowserGateSession>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
    });
    const view = render(<MechanismGateRoute runGate={runGate}/>);
    fireEvent.click(screen.getByRole("button", { name: /run gate again/i }));
    await act(async () => {});
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    view.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });
});
