import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const legacyRender = vi.hoisted(() => vi.fn(() => <main>Legacy workspace</main>));
vi.mock("./FoundationJourney", () => ({ FoundationJourney: legacyRender }));
vi.mock("./MechanismGateRoute", () => ({ MechanismGateRoute: () =>
  <main aria-label="SE-6 mechanism browser gate">Isolated mechanism route</main> }));

import { App } from "./App";

afterEach(() => { cleanup(); history.replaceState({}, "", "/"); legacyRender.mockClear(); });

test("selects the mechanism gate before WebGPU detection and the legacy workbench", async () => {
  history.replaceState({}, "", "/?mechanism-gate=1");
  render(<App/>);

  expect(await screen.findByLabelText("SE-6 mechanism browser gate")).toBeVisible();
  expect(legacyRender).not.toHaveBeenCalled();
  expect(screen.queryByText("Legacy workspace")).toBeNull();
});
