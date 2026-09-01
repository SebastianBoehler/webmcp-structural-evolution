import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../solver/structural/browser-structural-gate", () => ({
  runStructuralTopologyBrowserGateSession: vi.fn(),
  serializeLiveAcceptedTopologyStl: vi.fn(),
}));

import {
  runStructuralTopologyBrowserGateSession, serializeLiveAcceptedTopologyStl,
} from "../solver/structural/browser-structural-gate";
import { App } from "./App";

describe("structural topology report-only route", () => {
  beforeEach(() => {
    history.replaceState({}, "", "/?structural-topology-gate=1");
    vi.mocked(runStructuralTopologyBrowserGateSession).mockResolvedValue({
      models: [
        { modelId: "drone-motor-side-arm", authority: "parametric-specification-model",
          sourceRevision: "a".repeat(64), componentCount: 2, bodyCount: 2, state: "failure" },
        { modelId: "se6-upper-arm-housing", authority: "parametric-specification-model",
          sourceRevision: "b".repeat(64), componentCount: 1, bodyCount: 1, state: "failure" },
      ],
      report: {
        status: "blocked", evidenceSource: "live-browser-webgpu",
        blocker: { stage: "test-route", message: "isolated route proof" },
        console: { statusLines: [], warningCount: 0, errorCount: 0 },
      },
    });
  });

  it("mounts the isolated runner without the legacy structural workbench", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /structural \+ topology live webgpu gate/i }))
      .toBeVisible();
    expect((await screen.findByRole("alert")).textContent).toContain("isolated route proof");
    expect(screen.getByText("drone-motor-side-arm")).toBeVisible();
    expect(screen.getAllByText("parametric-specification-model")).toHaveLength(2);
    expect(screen.queryByText(/structural engineering workbench/i)).toBeNull();
  });

  it("silences the expected StrictMode cleanup cancellation", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(runStructuralTopologyBrowserGateSession).mockImplementation((signal) => new Promise((_, reject) => {
      signal!.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const mounted = render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByText("Running live gate…")).toBeVisible();
    mounted.unmount();
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
  });

  it("settles an unexpected runner rejection into terminal blocked UI", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(runStructuralTopologyBrowserGateSession)
      .mockRejectedValue(new Error("component documents rejected"));

    render(<App />);
    expect(await screen.findByText("Blocked at route-runner: component documents rejected"))
      .toBeVisible();
    expect(screen.queryByText("Running live gate…")).toBeNull();
    error.mockRestore();
  });

  it("serializes only the assigned SE-6 topology after a passed run", async () => {
    const capability = { sessionId: "a".repeat(64) };
    vi.mocked(runStructuralTopologyBrowserGateSession).mockResolvedValue({
      report: { status: "passed" } as never, capability, models: [],
    });
    vi.mocked(serializeLiveAcceptedTopologyStl)
      .mockReturnValueOnce(new DataView(new ArrayBuffer(184)));
    render(<App />);
    expect(await screen.findByText(/SE-6 STL serialization verified \(184 bytes\)/i)).toBeVisible();
    expect(serializeLiveAcceptedTopologyStl).toHaveBeenCalledOnce();
    expect(serializeLiveAcceptedTopologyStl).toHaveBeenCalledWith(capability, "cobot");
  });
});
