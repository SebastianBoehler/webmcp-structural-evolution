import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { App } from "./App";

test("shows the structural evolution foundation shell", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: /structural evolution/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /run foundation probe/i })).toBeDisabled();
});
