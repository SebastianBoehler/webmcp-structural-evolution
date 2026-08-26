import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { FoundationContextSnapshot } from "../domain/foundation-context";
import { referenceDroneAssembly } from "../samples/reference-drone-assembly";
import { REFERENCE_DRONE_CATALOG } from "../samples/reference-drone-catalog";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import { InspectorPanel } from "./InspectorPanel";

const context: FoundationContextSnapshot = {
  sourceRevision: "a".repeat(64),
  coordinateSpace: "assembly",
  unit: "mm",
  selection: { id: "frame", label: "Frame", min: [0, 0, 0], maxExclusive: [25, 25, 5] },
  locks: [],
  grid: {
    dimensions: { width: 25, height: 25, depth: 5 },
    cellSize: [10, 10, 5],
    anchor: { position: [-125, -125, -12.5], orientation: [0, 0, 0, 1] },
  },
  interfaces: { preservedMounts: 16, keepOuts: 9 },
  inventory: { status: "buildable", shortages: [], shortageCount: 0, omittedShortageCount: 0 },
};

const motor: AssemblyVisualPart = {
  id: "motor-east",
  selectionId: "motor-east",
  label: "East motor",
  appearance: "component",
  kind: "motor",
  center: [105, 0, 3],
  base: { radius: 12, height: 3, centerZ: 1.5 },
  stator: { radius: 11.25, height: 7.6, centerZ: 6.7 },
  bell: { radius: 14, height: 17, centerZ: 11.4 },
  shaft: { radius: 2.5, height: 12.1, centerZ: 25.85 },
  mountHoles: [],
  localBounds: { minimum: [-14, -14, 0], maximum: [14, 14, 31.9] },
  movable: true,
};

it("supports exact world-coordinate placement in millimetres", () => {
  const move = vi.fn();
  render(<InspectorPanel
    selectedId="motor-east"
    context={context}
    parts={[motor]}
    imports={[]}
    layoutState="verified"
    open
    onClose={() => undefined}
    onLockCableClearance={() => undefined}
    onMovePart={move}
  />);

  fireEvent.change(screen.getByRole("spinbutton", { name: "X position" }), { target: { value: "112" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Y position" }), { target: { value: "-8" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply exact position" }));

  expect(move).toHaveBeenCalledWith("motor-east", [112, -8, 3]);
  expect(screen.getByText(/world coordinates.*millimetres/i)).toBeVisible();
});

it("distinguishes exact release CAD from an unpublished mass budget", () => {
  const flightController: AssemblyVisualPart = {
    id: "flight-controller",
    selectionId: "flight-controller",
    label: "OpenFC-Lite-30x30-rev3.3",
    appearance: "component",
    kind: "model",
    center: [0, 0, 20],
    assetUrl: "/reference-cad/opendrone-openfc-lite-rev3.3.glb",
    assetUnits: "mm",
    size: [37.942302, 37.942302, 5.38],
  };
  render(<InspectorPanel
    selectedId="flight-controller"
    context={context}
    parts={[flightController]}
    imports={[]}
    assembly={referenceDroneAssembly}
    catalog={REFERENCE_DRONE_CATALOG}
    layoutState="verified"
    open
    onClose={() => undefined}
    onLockCableClearance={() => undefined}
    onMovePart={() => undefined}
  />);

  expect(screen.getByText("Exact licensed release CAD")).toBeVisible();
  expect(screen.getByText("17 g engineering budget")).toBeVisible();
  expect(screen.getByText(/does not publish assembled mass/i)).toBeVisible();
});
