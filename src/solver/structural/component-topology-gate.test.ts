import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDocument: vi.fn(), runStudy: vi.fn(), createAdapter: vi.fn(), observe: vi.fn(),
}));

vi.mock("../../models/component-documents", () => ({
  droneMotorSideArmDocument: mocks.loadDocument,
}));
vi.mock("../../workspace/component-showcase-runtime", () => ({
  runComponentStudy: mocks.runStudy,
}));
vi.mock("../topology/topology-adapter", () => ({
  createWebGpuTopologyAdapter: mocks.createAdapter,
}));
vi.mock("./browser-gpu-audit", () => ({
  createGateGpuAudit: () => ({ observe: mocks.observe,
    evidence: () => ({ vendor: "browser-gpu", architecture: "", device: "", description: "",
      features: [], acquisitionCount: 14, limits: { maxBufferSize: 1,
        maxStorageBufferBindingSize: 1, maxComputeWorkgroupsPerDimension: 1,
        maxComputeInvocationsPerWorkgroup: 1 } }),
    verifiedDiagnostics: () => ({ identitiesMatched: true, uncapturedErrorCount: 0,
      errorScopesClean: true, deviceLost: false }) }),
}));

import { runComponentTopologyGate } from "./component-topology-gate";

const acceptance = { eligible: true, accepted: false, exportable: false,
  promotionRequired: "task-5-live-gate", reasons: [] } as const;
const extraction = { closed: true, oriented: true, requiredInterfacesConnected: true,
  protectedVoidsClear: true, minimumFeatureSatisfied: true } as const;
const activeCells = new Uint32Array(9_114).fill(1);
const density = new Float32Array(9_114);
density.fill(1, 0, 3_190);
const output = {
  truthLevel: "interactive-estimate", density, materialFraction: 3_190 / 9_114,
  objectiveHistory: [.00078639, .00659850], extraction, acceptance,
  manufacturingMesh: { isoValue: .5 }, postExtractionAnalysis: {
    iterations: 2_490, maximumDisplacementM: .000419752,
    maximumVonMisesStressPa: 14_084_000, verification: { realGpu: true,
      relativeResidual: 9.924e-6, recomputedF32RelativeResidual: .00480525,
      wasmForceBalanceErrorN: 7.866e-5, energyRelativeMismatch: 3.192e-6 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadDocument.mockResolvedValue({ document: { revision: "a".repeat(64), studies: [{
    id: "drone-arm-topology", kind: "topology", configurationState: "configured",
    targetVolumeFraction: .35,
  }] } });
  mocks.runStudy.mockResolvedValue({ request: { input: { sourceStructuralRequest: { input: {
    voxelPayload: { activeCells },
  } } } }, result: { output }, artifactIds: ["topology-decision"] });
});

describe("real component topology gate report", () => {
  it("seals exact discrete material and audit-only promotion evidence", async () => {
    const report = await runComponentTopologyGate(new AbortController().signal);

    expect(report).toMatchObject({ status: "passed", evidenceSource: "live-browser-webgpu",
      scope: "audit-only", studyId: "drone-arm-topology", targetVolumeFraction: .35,
      result: { truthLevel: "interactive-estimate", materialCount: 3_190,
        domainCount: 9_114, materialFraction: 3_190 / 9_114, acceptance } });
    expect(mocks.createAdapter).toHaveBeenCalledWith({ onAcquisition: mocks.observe });
  });

  it("blocks a result that tries to skip Task 5 promotion", async () => {
    mocks.runStudy.mockResolvedValueOnce({ request: { input: { sourceStructuralRequest: { input: {
      voxelPayload: { activeCells },
    } } } }, result: { output: { ...output, acceptance: {
      ...acceptance, accepted: true, exportable: true,
    } } }, artifactIds: ["topology-decision"] });

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve", message: expect.stringMatching(/promotion/i),
    });
  });
});
