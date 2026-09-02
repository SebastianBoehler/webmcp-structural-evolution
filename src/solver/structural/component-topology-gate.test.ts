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
const sourceRevision = "a".repeat(64), studyDependency = {
  kind: "entity", reference: "study:drone-arm-topology",
} as const;
const artifactDependency = (artifactId: string) => ({ kind: "artifact", artifactId } as const);
const artifact = (
  idDigit: string, kind: string, mediaType: string,
  dependencies: readonly ({ readonly kind: "entity"; readonly reference: string }
    | { readonly kind: "artifact"; readonly artifactId: string })[],
) => ({ id: idDigit.repeat(64), kind, sourceRevision,
  producer: { name: "topology-test", version: "1" },
  settingsDigest: "b".repeat(64), contentDigest: "c".repeat(64), units: "m",
  mediaType, dependencies });
const semantic = artifact("1", "render-mesh", "application/vnd.structural-evolution.semantic-mesh", [
  { kind: "entity", reference: "body:drone-arm" },
]);
const sourceVoxel = artifact("2", "solver-mesh", "application/vnd.structural-evolution.voxel-domain-v1", [
  { kind: "entity", reference: "body:drone-arm" }, artifactDependency(semantic.id),
]);
const baseDependencies = [studyDependency, artifactDependency(semantic.id), artifactDependency(sourceVoxel.id)];
const densityHistory = artifact("3", "field", "application/vnd.structural-evolution.topology-history-v1",
  baseDependencies);
const manufacturingMesh = artifact("4", "manufacturing-mesh",
  "application/vnd.structural-evolution.topology-mesh-v1", baseDependencies);
const rerasterizedVoxel = artifact("5", "solver-mesh",
  "application/vnd.structural-evolution.voxel-domain-v1", [
    { kind: "entity", reference: "body:drone-arm" }, studyDependency,
    artifactDependency(semantic.id), artifactDependency(manufacturingMesh.id),
  ]);
const fieldDependencies = [studyDependency, artifactDependency(semantic.id),
  artifactDependency(rerasterizedVoxel.id)];
const displacement = artifact("6", "field",
  "application/vnd.structural-evolution.structural-field-v1; quantity=displacement",
  fieldDependencies);
const stress = artifact("7", "field",
  "application/vnd.structural-evolution.structural-field-v1; quantity=von-mises-stress",
  fieldDependencies);
const decision = artifact("8", "field", "application/vnd.structural-evolution.topology-decision-v1", [
  studyDependency, ...[densityHistory, manufacturingMesh, rerasterizedVoxel, displacement, stress]
    .map(({ id }) => artifactDependency(id)),
]);
const topologyArtifacts = [
  densityHistory, manufacturingMesh, rerasterizedVoxel, displacement, stress, decision,
];
const activeCells = new Uint32Array(9_114).fill(1);
const density = new Float32Array(9_114);
density.fill(1, 0, 3_190);
const output = {
  truthLevel: "interactive-estimate", density, materialFraction: 3_190 / 9_114,
  objectiveHistory: [.00078639, .00659850], extraction, acceptance,
  manufacturingMesh: { isoValue: .5 }, rerasterizedVoxelArtifact: rerasterizedVoxel,
  postExtractionAnalysis: {
    iterations: 2_490, maximumDisplacementM: .000419752,
    maximumVonMisesStressPa: 14_084_000, verification: { realGpu: true,
      relativeResidual: 9.924e-6, recomputedF32RelativeResidual: .00480525,
      directRelativeResidual: .0031,
      wasmForceBalanceErrorN: 7.866e-5, energyRelativeMismatch: 3.192e-6 },
  },
};

function runFixture(
  nextOutput: typeof output = output,
  records: readonly ReturnType<typeof artifact>[] = topologyArtifacts,
  missingPayloadIds: ReadonlySet<string> = new Set(),
) {
  const payloads = new Map(records.map((record, index) => [
    record.id, { bytes: Uint8Array.of(index + 1) },
  ]));
  return { request: {
    studyId: "drone-arm-topology", inputArtifacts: [semantic, sourceVoxel],
    input: { sourceStructuralRequest: { inputArtifacts: [semantic, sourceVoxel], input: {
      semanticMeshArtifactId: semantic.id, voxelArtifactId: sourceVoxel.id,
      voxelPayload: { activeCells },
    } } },
  }, result: { truthLevel: "interactive-estimate", output: nextOutput,
    artifacts: records.map((record) => ({ record, payload: payloads.get(record.id) })) },
  artifactIds: records.map(({ id }) => id),
  readArtifact: async (id: string) => missingPayloadIds.has(id) ? undefined : payloads.get(id) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadDocument.mockResolvedValue({ document: { revision: sourceRevision, studies: [{
    id: "drone-arm-topology", kind: "topology", configurationState: "configured",
    targetVolumeFraction: .35, minimumFeatureM: .0012,
  }] } });
  mocks.runStudy.mockResolvedValue(runFixture());
});

describe("real component topology gate report", () => {
  it("seals exact discrete material and audit-only promotion evidence", async () => {
    const report = await runComponentTopologyGate(new AbortController().signal);

    expect(report).toMatchObject({ status: "passed", evidenceSource: "live-browser-webgpu",
      scope: "audit-only", studyId: "drone-arm-topology", targetVolumeFraction: .35,
      minimumFeatureM: .0012,
      result: { truthLevel: "interactive-estimate", materialCount: 3_190,
        domainCount: 9_114, targetMaterialCount: 3_190,
        materialFraction: 3_190 / 9_114, acceptance,
        postExtractionAnalysis: { directRelativeResidual: .0031 },
        artifactIds: topologyArtifacts.map(({ id }) => id) } });
    expect(mocks.createAdapter).toHaveBeenCalledWith({ onAcquisition: mocks.observe });
  });

  it("blocks a result that tries to skip Task 5 promotion", async () => {
    mocks.runStudy.mockResolvedValueOnce(runFixture({ ...output, acceptance: {
      ...acceptance, accepted: true, exportable: true,
    } } as never));

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve", message: expect.stringMatching(/promotion/i),
    });
  });

  it("blocks coherent material evidence that misses the rounded 0.35 cell target", async () => {
    const offTarget = new Float32Array(activeCells.length); offTarget.fill(1, 0, 3_189);
    mocks.runStudy.mockResolvedValueOnce(runFixture({
      ...output, density: offTarget, materialFraction: 3_189 / 9_114,
    }));

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve",
      message: expect.stringMatching(/rounded target/i),
    });
  });

  it("blocks a component study whose authored minimum feature changed", async () => {
    mocks.loadDocument.mockResolvedValueOnce({ document: { revision: sourceRevision, studies: [{
      id: "drone-arm-topology", kind: "topology", configurationState: "configured",
      targetVolumeFraction: .35, minimumFeatureM: .0011,
    }] } });

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "component-document",
      message: expect.stringMatching(/minimum feature/i),
    });
  });

  it("blocks non-finite direct residual evidence without adding a new threshold", async () => {
    mocks.runStudy.mockResolvedValueOnce(runFixture({ ...output,
      postExtractionAnalysis: { ...output.postExtractionAnalysis,
        verification: { ...output.postExtractionAnalysis.verification,
          directRelativeResidual: Number.NaN } } }));

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve",
      message: expect.stringMatching(/direct residual/i),
    });
  });

  it("reports a finite direct residual without making it a new acceptance gate", async () => {
    mocks.runStudy.mockResolvedValueOnce(runFixture({ ...output,
      postExtractionAnalysis: { ...output.postExtractionAnalysis,
        verification: { ...output.postExtractionAnalysis.verification,
          directRelativeResidual: .75 } } }));

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "passed", result: { postExtractionAnalysis: { directRelativeResidual: .75 } },
    });
  });

  it("blocks an artifact bundle missing one of the six typed roles", async () => {
    mocks.runStudy.mockResolvedValueOnce(runFixture(output, topologyArtifacts.slice(0, -1)));

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve",
      message: expect.stringMatching(/artifact bundle/i),
    });
  });

  it("blocks an artifact receipt list with a duplicate seventh entry", async () => {
    const run = runFixture();
    mocks.runStudy.mockResolvedValueOnce({ ...run,
      artifactIds: [...run.artifactIds, run.artifactIds[0]] });

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve",
      message: expect.stringMatching(/six committed artifacts/i),
    });
  });

  it("blocks a typed role set whose record IDs do not equal its receipts", async () => {
    const duplicateRecordId = topologyArtifacts.map((record) => record === decision
      ? { ...record, id: stress.id } : record);
    const run = runFixture(output, duplicateRecordId);
    mocks.runStudy.mockResolvedValueOnce({ ...run,
      artifactIds: topologyArtifacts.map(({ id }) => id) });

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve",
      message: expect.stringMatching(/six committed artifacts/i),
    });
  });

  it("blocks an artifact role with the wrong kind", async () => {
    const wrongKind = topologyArtifacts.map((record) => record === densityHistory
      ? { ...record, kind: "export" } : record);
    mocks.runStudy.mockResolvedValueOnce(runFixture(output, wrongKind));

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve",
      message: expect.stringMatching(/artifact bundle/i),
    });
  });

  it("blocks an artifact role with incomplete revision-owned dependencies", async () => {
    const wrongDependencies = topologyArtifacts.map((record) => record === densityHistory
      ? { ...record, dependencies: [studyDependency] } : record);
    mocks.runStudy.mockResolvedValueOnce(runFixture(output, wrongDependencies));

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve",
      message: expect.stringMatching(/dependencies/i),
    });
  });

  it("blocks a typed artifact whose committed payload cannot be read", async () => {
    mocks.runStudy.mockResolvedValueOnce(runFixture(output, topologyArtifacts,
      new Set([decision.id])));

    await expect(runComponentTopologyGate(new AbortController().signal)).resolves.toMatchObject({
      status: "blocked", stage: "topology-solve",
      message: expect.stringMatching(/artifact payload/i),
    });
  });
});
