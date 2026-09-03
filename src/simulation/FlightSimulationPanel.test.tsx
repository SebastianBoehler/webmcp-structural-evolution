import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FlightSimulationPanel } from "./FlightSimulationPanel";

const motors = [
  { id: "motor-east", centerM: [0.105, 0, 0] as const },
  { id: "motor-north", centerM: [0, 0.105, 0] as const },
  { id: "motor-west", centerM: [-0.105, 0, 0] as const },
  { id: "motor-south", centerM: [0, -0.105, 0] as const },
];

describe("FlightSimulationPanel", () => {
  afterEach(cleanup);

  it("exposes deterministic assembly load cases and their truthful boundary", () => {
    render(<FlightSimulationPanel motors={motors} massKg={0.515} componentCount={36} batteryMassKg={0.254}
      onFrame={vi.fn()} componentsVisible onComponentsVisibleChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Hover" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Aggressive roll" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Pitch brake" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Yaw burst" })).toBeVisible();
    expect(screen.getByText(/mass model: 515 g.*36 attached parts.*battery 254 g/i)).toBeVisible();
    expect(screen.getByText(/visible candidate uses its existing per-case structural estimate fields/i)).toBeVisible();
    expect(screen.getByText(/replay does not re-solve or verify the topology.*flight approval/i)).toBeVisible();
  });

  it("starts a selected replay and can isolate the drone", () => {
    const onActiveChange = vi.fn();
    const onComponentsVisibleChange = vi.fn();
    const onFrame = vi.fn();
    render(<FlightSimulationPanel
      motors={motors}
      massKg={0.515}
      componentCount={36}
      batteryMassKg={0.254}
      onFrame={onFrame}
      onActiveChange={onActiveChange}
      componentsVisible
      onComponentsVisibleChange={onComponentsVisibleChange}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Aggressive roll" }));
    fireEvent.click(screen.getByRole("button", { name: "Run flight replay" }));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Frame only" }));
    expect(onComponentsVisibleChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Pause flight replay" }));
    expect(onFrame).toHaveBeenLastCalledWith(undefined);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("starts the exact named replay requested by an external agent command", () => {
    const props = {
      motors, massKg: 0.515, componentCount: 36, batteryMassKg: 0.254,
      onFrame: vi.fn(), componentsVisible: true, onComponentsVisibleChange: vi.fn(),
    };
    const view = render(<FlightSimulationPanel {...props} />);

    view.rerender(<FlightSimulationPanel {...props} command={{ requestId: 1, scenario: "yaw" }} />);

    expect(screen.getByRole("button", { name: "Yaw burst" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Pause flight replay" })).toBeVisible();
  });

  it("clears the replay frame and parent activity when unmounted while running", () => {
    const onFrame = vi.fn();
    const onActiveChange = vi.fn();
    const view = render(<FlightSimulationPanel
      motors={motors}
      massKg={0.515}
      componentCount={36}
      batteryMassKg={0.254}
      onFrame={onFrame}
      onActiveChange={onActiveChange}
      componentsVisible
      onComponentsVisibleChange={vi.fn()}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Run flight replay" }));

    view.unmount();

    expect(onFrame).toHaveBeenLastCalledWith(undefined);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("shows one clear prerequisite instead of unusable scenario controls", () => {
    render(<FlightSimulationPanel motors={[]} massKg={0.515} componentCount={36} batteryMassKg={0.254}
      onFrame={vi.fn()} componentsVisible onComponentsVisibleChange={vi.fn()} />);

    expect(screen.getByText(/generate a topology candidate before replaying its load cases/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Run flight replay" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Aggressive roll" })).toBeNull();
  });
});
