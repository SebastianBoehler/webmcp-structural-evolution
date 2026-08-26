import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FlightSimulationPanel } from "./FlightSimulationPanel";

describe("FlightSimulationPanel", () => {
  afterEach(cleanup);

  it("exposes the four structural cases and their fidelity boundary", () => {
    render(<FlightSimulationPanel motors={[]} massKg={0.515} componentCount={36} batteryMassKg={0.254}
      onFrame={vi.fn()} componentsVisible onComponentsVisibleChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Hover" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Aggressive roll" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Pitch brake" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Yaw burst" })).toBeVisible();
    expect(screen.getByText(/mass model: 515 g.*36 attached parts.*battery 254 g/i)).toBeVisible();
    expect(screen.getByText(/rigid-body replay.*not cfd.*transient.*fea/i)).toBeVisible();
  });

  it("starts a selected replay and can isolate the drone", () => {
    const onActiveChange = vi.fn();
    const onComponentsVisibleChange = vi.fn();
    render(<FlightSimulationPanel
      motors={[
        { id: "motor-east", centerM: [0.105, 0, 0] },
        { id: "motor-north", centerM: [0, 0.105, 0] },
        { id: "motor-west", centerM: [-0.105, 0, 0] },
        { id: "motor-south", centerM: [0, -0.105, 0] },
      ]}
      massKg={0.515}
      componentCount={36}
      batteryMassKg={0.254}
      onFrame={vi.fn()}
      onActiveChange={onActiveChange}
      componentsVisible
      onComponentsVisibleChange={onComponentsVisibleChange}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Aggressive roll" }));
    fireEvent.click(screen.getByRole("button", { name: "Run flight replay" }));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Frame only" }));
    expect(onComponentsVisibleChange).toHaveBeenLastCalledWith(false);
  });
});
