import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";
import { AssemblyTemplateTools } from "./assembly-template-tools";

let dispose: (() => void) | undefined;
afterEach(() => {
  cleanup();
  dispose?.();
  dispose = undefined;
});

const readText = (result: unknown) => JSON.parse(
  (result as { content: readonly { text: string }[] }).content[0]!.text,
) as Record<string, unknown>;

test("registers a bounded agent action that replaces the world with an approved typed assembly", async () => {
  const context = new FakeModelContext();
  dispose = installFakeModelContext(context);
  const onGenerate = vi.fn();
  render(<AssemblyTemplateTools current="reference-drone" onGenerate={onGenerate} />);

  await waitFor(() => expect(context.active.has("generate_approved_assembly")).toBe(true));
  expect(screen.getByText(/1 assembly generation tool registered/i)).toBeVisible();
  expect(context.active.get("generate_approved_assembly")?.annotations).toMatchObject({ readOnlyHint: false });

  const result = readText(await context.execute("generate_approved_assembly", { templateId: "se6-cobot" }));
  expect(result).toMatchObject({ templateId: "se6-cobot", status: "generated-visible-assembly" });
  expect(onGenerate).toHaveBeenCalledWith("se6-cobot");
});

test("rejects unapproved assembly identifiers without mutating the world", async () => {
  const context = new FakeModelContext();
  dispose = installFakeModelContext(context);
  const onGenerate = vi.fn();
  render(<AssemblyTemplateTools current="reference-drone" onGenerate={onGenerate} />);
  await waitFor(() => expect(context.active.has("generate_approved_assembly")).toBe(true));

  const result = await context.execute("generate_approved_assembly", { templateId: "invented-car" });
  expect(result).toMatchObject({ isError: true });
  expect(readText(result).error).toMatch(/approved assembly template/i);
  expect(onGenerate).not.toHaveBeenCalled();
});
