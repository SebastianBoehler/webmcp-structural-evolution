import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("./ThermalGateRoute", () => ({ ThermalGateRoute: () =>
  <main aria-label="SE-6 cobot thermal browser gate">Isolated thermal route</main> }));

import { App } from "./App";

test("selects the thermal gate before capability detection and the workbench", async () => {
  history.replaceState({}, "", "/?thermal-gate=1");
  render(<App/>);
  expect(await screen.findByLabelText("SE-6 cobot thermal browser gate")).toBeVisible();
  expect(screen.queryByText(/structural evolution/i)).toBeNull();
});
