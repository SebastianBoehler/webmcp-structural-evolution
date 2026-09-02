import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const legacyRender = vi.hoisted(() => vi.fn(() => <main>Legacy workspace</main>));
vi.mock("./FoundationJourney", () => ({ FoundationJourney: legacyRender }));
vi.mock("./ComponentTopologyGateRoute", () => ({ ComponentTopologyGateRoute: () =>
  <main aria-label="Real drone component topology gate">Drone gate</main> }));
vi.mock("./StructuralTopologyGateRoute", () => ({ StructuralTopologyGateRoute: () =>
  <main aria-label="SE6 auxiliary structural topology gate">SE6 gate</main> }));

import { App } from "./App";

afterEach(() => { cleanup(); history.replaceState({}, "", "/"); legacyRender.mockClear(); });

describe("component topology route selection", () => {
  it("selects the permanent real-component gate without the legacy workbench", async () => {
    history.replaceState({}, "", "/?component-topology-gate=1");
    render(<App/>);

    expect(await screen.findByLabelText("Real drone component topology gate")).toBeVisible();
    expect(legacyRender).not.toHaveBeenCalled();
  });

  it("keeps the SE6 auxiliary gate on its existing separate query", async () => {
    history.replaceState({}, "", "/?structural-topology-gate=1");
    render(<App/>);

    expect(await screen.findByLabelText("SE6 auxiliary structural topology gate")).toBeVisible();
    expect(screen.queryByLabelText("Real drone component topology gate")).toBeNull();
  });
});
