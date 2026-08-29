import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("shows the structural evolution foundation shell", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: /structural evolution/i })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));
  expect(screen.getByRole("button", { name: /generate balanced frame/i })).toBeDisabled();
});

test("switches the shared workbench to the detailed SE-6 cobot", async () => {
  render(<App />);

  fireEvent.change(screen.getByRole("combobox", { name: "Demo assembly" }), {
    target: { value: "se6-cobot" },
  });

  expect(await screen.findByText("Mounted 1.5 kg calibration payload")).toBeVisible();
  expect((screen.getByRole("combobox", { name: "Demo assembly" }) as HTMLSelectElement).value).toBe("se6-cobot");
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

  await waitFor(() => expect(screen.getByText(/compute available/i)).toBeVisible());
  expect(requestAdapter).toHaveBeenCalledOnce();
  expect(adapter.requestDevice).toHaveBeenCalledOnce();
  expect(device.destroy).toHaveBeenCalledOnce();
});
