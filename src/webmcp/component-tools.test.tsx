import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ComponentImport } from "../assembly/component-import";
import { droneAssemblyVisuals, INITIAL_MOTORS } from "../assembly/drone-workspace";
import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";
import { ComponentImportTools } from "./component-tools";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((dispose) => dispose());
});

const readText = (result: unknown) => JSON.parse(
  (result as { content: readonly { text: string }[] }).content[0]!.text,
) as Record<string, unknown>;

const stagedInput: ComponentImport = {
  name: "Reference battery",
  category: "electronics",
  manufacturer: "Example Cells",
  partNumber: "EC-4S",
  assetUrl: "https://example.com/battery.glb",
  assetUnits: "mm",
  sourceUrl: "https://example.com/datasheet",
  massG: 180,
  sizeMm: [105, 34, 29],
};

test("registers structured component inspection, staging, and visible movement tools", async () => {
  const context = new FakeModelContext();
  cleanups.push(installFakeModelContext(context));
  const onMove = vi.fn();
  const onStage = vi.fn((input: ComponentImport) => ({ ...input, id: "pending-1", stagedBy: "agent" as const }));
  const onValidate = vi.fn(async () => ({ revision: "r".repeat(64), conflicts: [] }));
  const parts = droneAssemblyVisuals(INITIAL_MOTORS, []);

  render(<ComponentImportTools
    imports={[]}
    parts={parts}
    layoutVersion={7}
    layoutState="changed"
    onMove={onMove}
    onStage={onStage}
    onValidate={onValidate}
  />);

  await waitFor(() => expect([...context.active.keys()].sort()).toEqual([
    "inspect_component_library", "move_assembly_component", "stage_component_import", "validate_assembly_layout",
  ]));
  expect(screen.getByText(/4 of 4 component tools registered/i)).toBeVisible();
  expect(context.active.get("inspect_component_library")?.annotations).toMatchObject({
    readOnlyHint: true,
    untrustedContentHint: true,
  });

  const inspection = readText(await context.execute("inspect_component_library", {}));
  expect(inspection.layoutVersion).toBe(7);
  expect(inspection.layoutState).toBe("changed");
  expect(inspection.topologyEvidence).toBe("stale");
  expect(inspection.nextAction).toBe("validate_assembly_layout");
  expect(inspection.movable).toEqual(expect.arrayContaining([
    expect.objectContaining({ componentId: "motor-east" }),
    expect.objectContaining({ componentId: "motor-east-propeller" }),
  ]));

  expect(readText(await context.execute("move_assembly_component", {
    componentId: "motor-east",
    expectedLayoutVersion: 7,
    xMm: 118,
    yMm: 14,
  }))).toMatchObject({ status: "moved-visible-layout-stale" });
  expect(onMove).toHaveBeenCalledWith("motor-east", [118, 14, 3], 7);

  expect(readText(await context.execute("validate_assembly_layout", {
    expectedLayoutVersion: 7,
  }))).toMatchObject({ status: "layout-verified", layoutVersion: 7, conflictCount: 0 });
  expect(onValidate).toHaveBeenCalledWith(7);

  expect(readText(await context.execute("stage_component_import", stagedInput))).toMatchObject({
    stagedImportId: "pending-1",
    status: "awaiting-human-review",
  });
  expect(onStage).toHaveBeenCalledWith(stagedInput);
});

test("returns a tool error instead of moving unknown or stale components", async () => {
  const context = new FakeModelContext();
  cleanups.push(installFakeModelContext(context));
  const onMove = vi.fn(() => { throw new Error("Layout is stale. Inspect version 4 before moving a component."); });
  render(<ComponentImportTools
    imports={[]}
    parts={droneAssemblyVisuals(INITIAL_MOTORS, [])}
    layoutVersion={4}
    onMove={onMove}
    onStage={(input) => ({ ...input, id: "pending-1", stagedBy: "agent" })}
  />);
  await waitFor(() => expect(context.active.has("move_assembly_component")).toBe(true));

  const unknown = await context.execute("move_assembly_component", {
    componentId: "missing", expectedLayoutVersion: 4, xMm: 0, yMm: 0,
  });
  expect(unknown).toMatchObject({ isError: true });
  expect(readText(unknown).error).toMatch(/not movable/i);

  const stale = await context.execute("move_assembly_component", {
    componentId: "motor-east", expectedLayoutVersion: 3, xMm: 110, yMm: 0,
  });
  expect(stale).toMatchObject({ isError: true });
  expect(readText(stale).error).toMatch(/layout is stale/i);
});

test("does not advertise movement when the active assembly has no movable components", async () => {
  const context = new FakeModelContext();
  cleanups.push(installFakeModelContext(context));
  render(<ComponentImportTools
    imports={[]}
    parts={[{
      id: "j1-turntable", selectionId: "j1-turntable", label: "J1 base-yaw turntable",
      appearance: "component", kind: "cylinder", center: [0, 0, 268], radius: 82, height: 52,
      movable: false,
    }]}
    layoutVersion={1}
    onMove={vi.fn()}
    onStage={(input) => ({ ...input, id: "pending-1", stagedBy: "agent" })}
  />);

  await waitFor(() => expect(context.active.has("inspect_component_library")).toBe(true));
  expect(context.active.has("move_assembly_component")).toBe(false);
  expect(screen.getByText(/2 of 2 component tools registered/i)).toBeVisible();
});
