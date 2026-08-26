import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("shows the structural evolution foundation shell", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: /structural evolution/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /generate balanced frame/i })).toBeDisabled();
});

test("does not treat CSS-hidden descendants as visible", () => {
  render(<div style={{ display: "none" }}><p>Hidden status</p></div>);

  expect(screen.getByText("Hidden status")).not.toBeVisible();
});

test("shares one WebGPU capability acquisition across a StrictMode lifecycle", async () => {
  const device = { destroy: vi.fn(), lost: new Promise(() => undefined) };
  const adapter = { requestDevice: vi.fn().mockResolvedValue(device) };
  const requestAdapter = vi.fn().mockResolvedValue(adapter);
  vi.stubGlobal("navigator", { gpu: { requestAdapter } });

  render(<StrictMode><App /></StrictMode>);

  await waitFor(() => expect(screen.getByText(/webgpu available/i)).toBeVisible());
  expect(requestAdapter).toHaveBeenCalledOnce();
  expect(adapter.requestDevice).toHaveBeenCalledOnce();
  expect(device.destroy).toHaveBeenCalledOnce();
});
