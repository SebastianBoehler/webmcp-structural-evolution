import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ComponentTopologyGateReport } from "../solver/structural/component-topology-gate";
import { ComponentTopologyGateRoute } from "./ComponentTopologyGateRoute";

const report = {
  status: "passed", evidenceSource: "live-browser-webgpu", scope: "audit-only",
  studyId: "drone-arm-topology", targetVolumeFraction: .35,
  minimumFeatureM: .0012,
  sourceRevision: "a".repeat(64), timingMs: 67_578,
  result: {
    truthLevel: "interactive-estimate", materialCount: 3_190, domainCount: 9_114,
    targetMaterialCount: 3_190,
    materialFraction: 3_190 / 9_114, objectiveHistoryJ: [.00078639, .00659850],
    extraction: { closed: true, oriented: true, requiredInterfacesConnected: true,
      protectedVoidsClear: true, minimumFeatureSatisfied: true },
    acceptance: { eligible: true, accepted: false, exportable: false,
      promotionRequired: "task-5-live-gate", reasons: [] },
    postExtractionAnalysis: { iterations: 2_490, relativeResidual: 9.924e-6,
      recomputedF32RelativeResidual: .00480525, directRelativeResidual: .0031,
      wasmForceBalanceErrorN: 7.866e-5,
      energyRelativeMismatch: 3.192e-6, maximumDisplacementM: .000419752,
      maximumVonMisesStressPa: 14_084_000 },
    artifactIds: ["density-history", "manufacturing-mesh", "rerasterized-voxel",
      "displacement", "stress", "topology-decision"],
  },
  device: { vendor: "browser-gpu", architecture: "", device: "", description: "",
    features: [], acquisitionCount: 14, limits: { maxBufferSize: 1,
      maxStorageBufferBindingSize: 1, maxComputeWorkgroupsPerDimension: 1,
      maxComputeInvocationsPerWorkgroup: 1 } },
  gpuDiagnostics: { identitiesMatched: true, uncapturedErrorCount: 0,
    errorScopesClean: true, deviceLost: false },
} as const satisfies ComponentTopologyGateReport;

describe("component topology gate route", () => {
  it("labels the live drone estimate as audit-only and promotion-required", async () => {
    const runGate = vi.fn(async () => report);
    render(<ComponentTopologyGateRoute runGate={runGate}/>);

    expect(await screen.findByRole("heading", {
      name: /real drone motor-side component topology gate/i,
    })).toBeVisible();
    expect(screen.getByText(/live WebGPU/i)).toBeVisible();
    expect(screen.getByText(
      "The result is an interactive estimate and the captured evidence is audit-only.",
    )).toBeVisible();
    expect(screen.getByText(/promotion is required/i)).toBeVisible();
    expect(screen.getByTestId("component-topology-gate-report").textContent)
      .toContain('"exportable": false');
  });

  it("settles a rejected runner into terminal blocked UI", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ComponentTopologyGateRoute runGate={async () => {
      throw new Error("component model rejected");
    }}/>);

    expect((await screen.findByRole("alert")).textContent)
      .toContain("Blocked at route-runner: component model rejected");
    expect(screen.queryByText(/Running real component topology gate/i)).toBeNull();
    error.mockRestore();
  });
});
