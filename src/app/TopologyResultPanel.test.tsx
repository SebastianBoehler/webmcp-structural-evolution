import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import type { ViewerBranch } from "../viewer/alternative-instances";
import { TopologyResultPanel } from "./TopologyResultPanel";

const branch: ViewerBranch = {
  branchRevision: "branch", contextRevision: "context", parentRevision: "parent",
  grid: { dimensions: { width: 1, height: 1, depth: 1 }, cellSize: [1, 1, 1], anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] } },
  result: {
    status: "verified", output: new Float32Array([0.35]), elapsedMs: 409, relativeL2: 0, tolerance: 0,
    topology: {
      solver: "sparse-simp-lattice-wasm", initialCompliance: 2, finalCompliance: 1,
      maxDisplacement: 0.00002, maxStress: 650_000, minimumSafetyFactor: 69,
      materialFraction: 0.35, iterations: 8, estimatedFrameMassKg: 0.111,
    },
  },
};

test("labels arbitrary topology evidence from the active study instead of the drone preset", () => {
  render(<TopologyResultPanel
    branch={branch}
    topologySubject="link"
    materialLabel="PA12"
    assemblyId="robot-arm-link"
    loadCaseIds={["payload-down", "emergency-side"]}
  />);

  expect(screen.getByText("Optimized link")).toBeVisible();
  expect(screen.getByText(/balanced · PA12/i)).toBeVisible();
  expect(screen.getByText("payload-down · emergency-side")).toBeVisible();
  expect(screen.getByText(/2 cases · 8 iter · 409 ms/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /export link STL/i })).toBeVisible();
  expect(screen.queryByText(/hover · roll · pitch · yaw/i)).toBeNull();
});
