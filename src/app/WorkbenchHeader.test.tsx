import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { WorkbenchHeader } from "./WorkbenchHeader";

test("uses a compact icon-only appearance control", () => {
  const onThemeChange = vi.fn();
  render(<WorkbenchHeader
    capability={{ status: "available", message: "Test adapter acquired." }}
    mode="assembly"
    theme="system"
    fixtureId="reference-drone"
    onModeChange={vi.fn()}
    onFixtureChange={vi.fn()}
    onThemeChange={onThemeChange}
  />);

  expect(screen.queryByRole("combobox", { name: "Appearance" })).toBeNull();
  const system = screen.getByRole("button", { name: "Use system theme" });
  expect(system.getAttribute("aria-pressed")).toBe("true");
  expect(system.textContent).not.toMatch(/system/i);

  fireEvent.click(screen.getByRole("button", { name: "Use light theme" }));
  fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
  expect(onThemeChange.mock.calls).toEqual([["light"], ["dark"]]);
});
