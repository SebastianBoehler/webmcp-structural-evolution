import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const legacyRender = vi.hoisted(() => vi.fn(() => <main>Legacy workspace</main>));
vi.mock("./FoundationJourney", () => ({ FoundationJourney: legacyRender }));
vi.mock("./use-exact-cad-project-gate", () => ({
  useExactCadProjectGate: () => ({ status: "running" }),
}));

import { App } from "./App";

afterEach(() => {
  cleanup();
  history.replaceState({}, "", "/");
  legacyRender.mockClear();
});

test("selects the exact CAD route before loading the legacy workspace component", () => {
  history.replaceState({}, "", "/?exact-cad-gate=1");

  render(<App />);

  expect(screen.getByLabelText("Exact CAD browser gate")).toBeVisible();
  expect(screen.getByText(/legacy geometry is withheld/i)).toBeVisible();
  expect(legacyRender).not.toHaveBeenCalled();
  expect(screen.queryByText("Legacy workspace")).toBeNull();
});
