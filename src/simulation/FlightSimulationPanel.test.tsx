import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FlightSimulationPanel } from "./FlightSimulationPanel";

describe("FlightSimulationPanel", () => {
  afterEach(cleanup);

  it("exposes the four structural cases and their fidelity boundary", () => {
    render(<FlightSimulationPanel motors={[]} massKg={0.495} onFrame={vi.fn()} onDroneOnlyChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Hover" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Aggressive roll" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Pitch brake" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Yaw burst" })).toBeVisible();
    expect(screen.getByText(/rigid-body replay.*not cfd.*transient.*fea/i)).toBeVisible();
  });

  it("starts a selected replay and can isolate the drone", () => {
    const onActiveChange = vi.fn();
    const onDroneOnlyChange = vi.fn();
    render(<FlightSimulationPanel
      motors={[
        { id: "motor-east", centerM: [0.105, 0, 0] },
        { id: "motor-north", centerM: [0, 0.105, 0] },
        { id: "motor-west", centerM: [-0.105, 0, 0] },
        { id: "motor-south", centerM: [0, -0.105, 0] },
      ]}
      massKg={0.495}
      onFrame={vi.fn()}
      onActiveChange={onActiveChange}
      onDroneOnlyChange={onDroneOnlyChange}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Aggressive roll" }));
    fireEvent.click(screen.getByRole("button", { name: "Run flight replay" }));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Drone-only view" }));
    expect(onDroneOnlyChange).toHaveBeenLastCalledWith(true);
  });
});
