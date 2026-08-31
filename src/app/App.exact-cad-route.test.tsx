import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const legacyRender = vi.hoisted(() => vi.fn(() => <main>Legacy workspace</main>));
const gateState = vi.hoisted(() => ({ value: { status: "running" } as unknown }));
vi.mock("./FoundationJourney", () => ({ FoundationJourney: legacyRender }));
vi.mock("./use-exact-cad-project-gate", () => ({
  useExactCadProjectGate: () => gateState.value,
}));
vi.mock("../viewer/FieldViewer", () => ({
  FieldViewer: ({ assemblyParts }: { assemblyParts: readonly { mesh: { triangleCount: number } }[] }) => (
    <canvas aria-label="Exact semantic mesh" data-triangle-count={assemblyParts[0]?.mesh.triangleCount} />
  ),
}));

import { App } from "./App";

afterEach(() => {
  cleanup();
  history.replaceState({}, "", "/");
  legacyRender.mockClear();
  gateState.value = { status: "running" };
});

test("selects the exact CAD route before loading the legacy workspace component", async () => {
  history.replaceState({}, "", "/?exact-cad-gate=1");

  render(<App />);

  expect(await screen.findByLabelText("Exact CAD browser gate")).toBeVisible();
  expect(await screen.findByText(/legacy geometry is withheld/i)).toBeVisible();
  expect(legacyRender).not.toHaveBeenCalled();
  expect(screen.queryByText("Legacy workspace")).toBeNull();
});

test("reserves a visible grid row for the verified exact mesh", async () => {
  history.replaceState({}, "", "/?exact-cad-gate=1");
  gateState.value = {
    status: "passed",
    result: {
      status: "passed",
      timingsMs: {
        authoring: 1, initialRebuild: 1, dimensionRebuild: 1,
        stepRoundTrip: 1, cancellation: 1, finalRebuild: 1, total: 7,
      },
      revisions: { initial: "a".repeat(64), dimension: "b".repeat(64) },
      hashes: {
        initialBrep: "c".repeat(64), dimensionBrep: "d".repeat(64),
        finalBrep: "d".repeat(64), initialStep: "e".repeat(64), dimensionStep: "f".repeat(64),
      },
      measurements: {
        maximumMassRelativeError: 0, maximumVolumeRelativeError: 0, invalidSolidCount: 0,
      },
      stepRoundTrip: {
        expectedEnvelopeMm: [100, 40, 20], importedEnvelopeMm: [100, 40, 20],
        envelopeRelativeError: 0,
      },
      cancellation: { outcome: "cancelled", lateSuccess: false, workerDisposition: "quarantined" },
      artifacts: { invalidatedCount: 3, staleCount: 0, activeCount: 4 },
      renderMesh: {
        surfaces: [{
          name: "exact", positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
        }],
        sizeMm: [100, 40, 20], triangleCount: 1,
      },
    },
  };

  render(<App />);

  const workspace = (await screen.findByRole("heading", { name: "Exact CAD browser gate passed" })).closest("section");
  expect(workspace?.classList.contains("exact-cad-gate-workspace")).toBe(true);
  expect(screen.getByLabelText("Exact semantic mesh").getAttribute("data-triangle-count")).toBe("1");
});
