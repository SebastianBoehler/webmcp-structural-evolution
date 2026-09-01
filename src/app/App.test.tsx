import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { FoundationJourneyProps } from "./foundation-journey-types";

const journey = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const loaded = new Promise<void>((resolve) => { release = resolve; });
  return { component: vi.fn(() => null), loaded, release: () => release() };
});

vi.mock("./FoundationJourney", async () => {
  await journey.loaded;
  return { FoundationJourney: journey.component };
});

import { App } from "./App";

function lastJourneyProps(): FoundationJourneyProps {
  return (((journey.component.mock.calls.at(-1) as unknown as [FoundationJourneyProps] | undefined)?.[0]) as FoundationJourneyProps);
}

afterEach(() => {
  cleanup();
  journey.component.mockClear();
  vi.unstubAllGlobals();
});

test("keeps App's loading shell until the foundation route resolves", async () => {
  render(<App />);

  expect(screen.getByRole("status").textContent).toBe("Loading structural workbench…");
  journey.release();
  await waitFor(() => expect(journey.component).toHaveBeenCalledOnce());

  expect(lastJourneyProps()).toMatchObject({
    fixtureId: "reference-drone",
    capability: { status: "unavailable", code: "api-unavailable" },
  });
});

test("owns fixture wiring while leaving the foundation UI to its route", async () => {
  journey.release();
  render(<App />);
  await waitFor(() => expect(journey.component).toHaveBeenCalledOnce());

  act(() => lastJourneyProps().onFixtureChange?.("se6-cobot"));

  await waitFor(() => expect(lastJourneyProps().fixtureId).toBe("se6-cobot"));
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
  journey.release();

  render(<StrictMode><App /></StrictMode>);

  await waitFor(() => expect(lastJourneyProps().capability.status).toBe("available"));
  expect(requestAdapter).toHaveBeenCalledOnce();
  expect(adapter.requestDevice).toHaveBeenCalledOnce();
  expect(device.destroy).toHaveBeenCalledOnce();
});
