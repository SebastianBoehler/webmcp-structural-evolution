import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { DEMO_FIXTURES } from "../samples/demo-fixtures";
import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";

vi.mock("../gpu/capabilities", () => ({
  detectWebGpuSingleFlight: vi.fn(async () => ({ status: "available", message: "Test adapter acquired." })),
}));
vi.mock("../viewer/FieldViewer", () => ({ FieldViewer: () => null }));

import { App } from "./App";

let dispose: (() => void) | undefined;
afterEach(() => {
  cleanup();
  dispose?.();
  dispose = undefined;
  window.history.replaceState({}, "", "/");
});

const readText = (result: unknown) => JSON.parse(
  (result as { content: readonly { text: string }[] }).content[0]!.text,
) as Record<string, unknown>;

test("remounts from SE-6 to reference drone and requires fresh registered inspection tools", async () => {
  window.history.replaceState({}, "", "/");
  const context = new FakeModelContext();
  dispose = installFakeModelContext(context);
  render(<App />);
  const fixture = await screen.findByRole(
    "combobox",
    { name: "Demo assembly" },
    { timeout: 5_000 },
  );
  await waitFor(() => expect(context.active.has("generate_approved_assembly")).toBe(true));
  const initialGenerator = context.active.get("generate_approved_assembly");

  fireEvent.change(fixture, { target: { value: "se6-cobot" } });
  await waitFor(() => expect(context.active.get("generate_approved_assembly")).not.toBe(initialGenerator));
  const se6Generator = context.active.get("generate_approved_assembly");
  const se6Components = context.active.get("inspect_component_library");
  const se6Inspection = readText(await context.execute("inspect_design_context", { scope: "current" }));
  expect(se6Inspection.context).toEqual(DEMO_FIXTURES["se6-cobot"].context);

  let generated: unknown;
  await act(async () => {
    generated = await context.execute("generate_approved_assembly", { templateId: "reference-drone" });
  });
  expect(readText(generated)).toMatchObject({
    status: "remount-requested",
    nextAction: "wait_for_assembly_remount_and_refetch_tools",
  });
  await waitFor(() => expect(context.active.get("generate_approved_assembly")).not.toBe(se6Generator));
  expect(context.active.get("inspect_component_library")).not.toBe(se6Components);

  const componentInspection = readText(await context.execute("inspect_component_library", {}));
  expect(componentInspection).toMatchObject({ layoutVersion: 1, layoutState: "verified" });
  const referenceInspection = readText(await context.execute("inspect_design_context", { scope: "current" }));
  expect(referenceInspection.context).toEqual(DEMO_FIXTURES["reference-drone"].context);
  expect(context.aborted).toContain("generate_approved_assembly");
  expect(context.aborted).toContain("inspect_component_library");
});
