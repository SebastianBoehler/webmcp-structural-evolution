import { defineArtifactRecord, type ArtifactRecord } from "../cad/artifact-contract";
import { defineEngineeringSolveRequest } from "../cad/engineering-job-contract";
import { createDesignSession } from "../cad/design-session";
import type { DesignDocument } from "../cad/document-schema";
import { encodeCadOutputPayload } from "../cad/rebuild-payload";
import { createArtifactStore, digestArtifactPayload, type ArtifactPayload, type ArtifactStore } from "../engineering/artifact-store";
import { createSolverRegistry } from "../engineering/solver-registry";
import type { EngineeringSolveRequest, SolverRunResult } from "../engineering/solver-adapter";
import { createCobotThermalDocument } from "../samples/cobot/cobot-thermal-study";
import { createThermalAnalyticalRequest } from "../solver/thermal/thermal-analytical-request";
import {
  THERMAL_VOXEL_MEDIA_TYPE, THERMAL_VOXEL_PRODUCER, type ThermalSolveInput,
} from "../solver/thermal/thermal-contract";
import { cadAdapter } from "./workspace-test-fixtures";
import {
  createEngineeringWorkspaceService, type EngineeringWorkspaceOptions,
  type EngineeringWorkspaceService, type StudyCompilation,
} from "./engineering-workspace-service";

export type ExactCobotPlan = Readonly<{
  document: DesignDocument;
  roots: readonly Readonly<{ record: ArtifactRecord; payload: ArtifactPayload }>[];
  derived: Readonly<{ record: ArtifactRecord; payload: ArtifactPayload }>;
  compilation: StudyCompilation;
}>;

const coverage = (document: DesignDocument) => [
  { kind: "entity" as const, reference: `document:${document.id}` as const },
  { kind: "entity" as const, reference: "feature:feature-upper-arm-link" as const },
  { kind: "entity" as const, reference: "body:upper-arm-link" as const },
];

export async function exactCobotPlan(jobId: string, voxelValue = 1): Promise<ExactCobotPlan> {
  const analytical = await createThermalAnalyticalRequest({
    dimensions: [2, 1, 1], cellSizeM: .01,
    bodies: [{ id: "upper-arm-link", materialId: "aluminum-6061", conductivityWmK: 167 }],
    cellBodyIndices: new Uint32Array(2),
    boundaries: [
      { id: "mounting-interface", cellIndex: 0, axis: 0, direction: -1, areaM2: .0064, temperatureK: 300 },
      { id: "motor-interface", cellIndex: 1, axis: 0, direction: 1, areaM2: .0064, heatFluxWm2: 12_500 },
    ],
  });
  const document = await createCobotThermalDocument(
    analytical.document, analytical.input.semanticMeshPayload,
  );
  const exactDependencies = coverage(document);
  const sourceBrep = analytical.inputArtifacts.find(({ id }) => id === analytical.input.exactBrepArtifactId)!;
  const sourceSemantic = analytical.inputArtifacts.find(({ id }) => id === analytical.input.semanticMeshArtifactId)!;
  const brepPayload = Uint8Array.of(79, 67, 67, 84);
  const brep = await defineArtifactRecord({
    kind: "brep", sourceRevision: document.revision,
    producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: sourceBrep.settingsDigest,
    contentDigest: await digestArtifactPayload(brepPayload), units: "m",
    mediaType: "application/vnd.opencascade.brep", dependencies: exactDependencies,
  });
  const semanticPayload = analytical.input.semanticMeshPayload;
  const semantic = await defineArtifactRecord({
    kind: "render-mesh", sourceRevision: document.revision,
    producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: sourceSemantic.settingsDigest,
    contentDigest: sourceSemantic.contentDigest, units: "m",
    mediaType: "application/vnd.structural-evolution.semantic-mesh", dependencies: exactDependencies,
  });
  const voxelPayload = {
    ...analytical.input.voxelPayload,
    rasterizationToleranceM: new Float64Array([voxelValue * .0001]),
  };
  const voxel = await defineArtifactRecord({
    kind: "sdf", sourceRevision: document.revision, producer: THERMAL_VOXEL_PRODUCER,
    settingsDigest: "d".repeat(64), contentDigest: await digestArtifactPayload(voxelPayload), units: "m",
    mediaType: THERMAL_VOXEL_MEDIA_TYPE,
    dependencies: [...exactDependencies,
      { kind: "artifact", artifactId: brep.id },
      { kind: "artifact", artifactId: semantic.id }],
  });
  const request = await defineEngineeringSolveRequest<ThermalSolveInput>({
    jobId, kind: "thermal", sourceRevision: document.revision,
    inputArtifacts: [brep, semantic, voxel], settings: { model: "se6-upper-arm" },
    studyId: "se6-upper-arm-thermal", document,
    input: {
      exactBrepArtifactId: brep.id,
      semanticMeshArtifactId: semantic.id, semanticMeshPayload: semanticPayload,
      thermalVoxelArtifactId: voxel.id, voxelPayload,
    },
  });
  return {
    document,
    roots: [
      { record: brep, payload: brepPayload },
      { record: semantic, payload: encodeCadOutputPayload(semanticPayload) },
    ],
    derived: { record: voxel, payload: voxelPayload },
    compilation: { request, inputs: [{ record: voxel, payload: voxelPayload }] },
  };
}

export async function redefineInput(
  plan: ExactCobotPlan,
  record: ArtifactRecord,
  payload: ArtifactPayload,
): Promise<ExactCobotPlan> {
  const source = plan.compilation.request as EngineeringSolveRequest<ThermalSolveInput>;
  const request = await defineEngineeringSolveRequest<ThermalSolveInput>({
    ...source,
    inputArtifacts: source.inputArtifacts.map((candidate) =>
      candidate.id === source.input.thermalVoxelArtifactId ? record : candidate),
    input: { ...source.input, thermalVoxelArtifactId: record.id },
  });
  return { ...plan, derived: { record, payload }, compilation: { request, inputs: [{ record, payload }] } };
}

export async function thermalResult(
  request: EngineeringSolveRequest<unknown>, value: number, linked = true,
): Promise<SolverRunResult<{ readonly completed: true }>> {
  const payload = Uint8Array.of(value);
  const thermal = request as EngineeringSolveRequest<ThermalSolveInput>;
  const record = await defineArtifactRecord({
    kind: "field", sourceRevision: request.sourceRevision,
    producer: { name: "thermal-test-adapter", version: "1" }, settingsDigest: "e".repeat(64),
    contentDigest: await digestArtifactPayload(payload), units: "m",
    mediaType: "application/vnd.engineering.temperature-field",
    dependencies: [
      { kind: "entity", reference: `study:${request.studyId}` },
      ...(linked ? [{ kind: "artifact" as const, artifactId: thermal.input.thermalVoxelArtifactId }] : []),
    ],
  });
  return { output: { completed: true }, truthLevel: "converged-numerical-solve", artifacts: [{ record, payload }] };
}

export async function serviceForPlans(
  plans: readonly ExactCobotPlan[],
  run: (request: EngineeringSolveRequest<unknown>) => Promise<SolverRunResult<unknown>>,
  store: ArtifactStore = createArtifactStore(),
): Promise<Readonly<{ service: EngineeringWorkspaceService; store: ArtifactStore }>> {
  const first = plans[0]!;
  await store.commit(first.roots, () => true);
  const registry = createSolverRegistry();
  registry.register({ capability: { kind: "thermal" }, supports: () => ({ supported: true }), run });
  let index = 0;
  const options: EngineeringWorkspaceOptions = {
    session: createDesignSession(first.document, first.roots.map(({ record }) => record)),
    store, registry,
    createCadAdapter: () => cadAdapter(async () => { throw new Error("CAD is outside this lineage test"); }),
    planners: { "thermal-steady": async () => plans[Math.min(index++, plans.length - 1)]!.compilation },
    clock: { now: () => "2026-09-01T12:00:00.000Z", elapsedMs: () => 1 },
  };
  return { service: createEngineeringWorkspaceService(options), store };
}

export async function waitForJob(service: EngineeringWorkspaceService, jobId: string, state: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (service.inspectJob(jobId).event.state === state) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${jobId} to become ${state}`);
}
