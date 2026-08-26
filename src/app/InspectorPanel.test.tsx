import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { FoundationContextSnapshot } from "../domain/foundation-context";
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
  center: [105, 0, 12],
  radius: 14,
  height: 19.9,
  shaftRadius: 2.5,
  shaftHeight: 12,
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

  expect(move).toHaveBeenCalledWith("motor-east", [112, -8, 12]);
  expect(screen.getByText(/world coordinates.*millimetres/i)).toBeVisible();
});
