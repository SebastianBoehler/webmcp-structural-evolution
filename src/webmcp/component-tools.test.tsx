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
  const parts = droneAssemblyVisuals(INITIAL_MOTORS, []);

  render(<ComponentImportTools
    imports={[]}
    parts={parts}
    layoutVersion={7}
    onMove={onMove}
    onStage={onStage}
  />);

  await waitFor(() => expect([...context.active.keys()].sort()).toEqual([
    "inspect_component_library", "move_assembly_component", "stage_component_import",
  ]));
  expect(screen.getByText(/3 of 3 component tools registered/i)).toBeVisible();
  expect(context.active.get("inspect_component_library")?.annotations).toMatchObject({
    readOnlyHint: true,
    untrustedContentHint: true,
  });

  const inspection = readText(await context.execute("inspect_component_library", {}));
  expect(inspection.layoutVersion).toBe(7);
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
  expect(onMove).toHaveBeenCalledWith("motor-east", [118, 14, 12], 7);

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
