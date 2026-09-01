import { defineArtifactRecord, type ArtifactRecord } from "../cad/artifact-contract";
import type { DesignTransaction } from "../cad/command-schema";
import type { DesignDocument } from "../cad/document-schema";
import type {
  CadEvaluationEvent, CadEvaluationRequest, CadKernelAdapter,
} from "../cad/runtime-contracts";
import { digestCadOutputPayload, type SemanticMeshPayload } from "../cad/rebuild-payload";
import { createDesignSession } from "../cad/design-session";
import { defineEngineeringSolveRequest } from "../cad/engineering-job-contract";
import { createArtifactStore, digestArtifactPayload, type ArtifactPayload } from "../engineering/artifact-store";
import { sourceDocument } from "../engineering/job-runner-test-fixtures";
import { createSolverRegistry } from "../engineering/solver-registry";
import type { EngineeringSolveRequest, SolverAdapter, SolverRunResult } from "../engineering/solver-adapter";
import type {
  EngineeringWorkspaceOptions, StudyRequestPlanner,
} from "./engineering-workspace-service";
import { STRUCTURAL_VOXEL_MEDIA_TYPE, type StructuralVoxelPayload } from "../solver/structural/structural-contract";

export const human = { kind: "human", id: "sebastian" } as const;
export const agent = { kind: "agent", id: "design-agent" } as const;

export const rename = (
  document: DesignDocument,
  id: string,
  label: string,
  actor: DesignTransaction["actor"] = human,
): DesignTransaction => ({
  id,
  expectedRevision: document.revision,
  actor,
  preconditions: [],
  commands: [{ id: `${id}-rename`, type: "rename-document", label }],
});

export async function cadResult(
  request: Readonly<{
    requestId: string;
    document: DesignDocument;
    sourceRevision: string;
    requestedOutputs: readonly string[];
  }>,
  value = 7,
): Promise<Extract<CadEvaluationEvent, { state: "succeeded" }>> {
  const payload = { bytes: Uint8Array.of(value) };
  const artifact = await defineArtifactRecord({
    kind: "export",
    sourceRevision: request.sourceRevision,
    producer: { name: "test-cad", version: "1.0.0" },
    settingsDigest: "a".repeat(64),
    contentDigest: await digestCadOutputPayload(payload),
    units: "m",
    mediaType: "model/step",
    dependencies: [{ kind: "entity", reference: "document:link" }],
  });
  return {
    requestId: request.requestId,
    state: "succeeded",
    sourceRevision: request.sourceRevision,
    requestedOutputs: ["step"],
    results: [{ output: "step", artifact, payload }],
  };
}

export function cadAdapter(
  evaluate: CadKernelAdapter["evaluate"],
  dispose = () => undefined,
): CadKernelAdapter {
  return {
    evaluate,
    async importStep() { throw new Error("STEP import is outside the workspace test boundary"); },
    dispose,
  };
}

export async function solveResult(
  request: EngineeringSolveRequest<unknown>,
  value: number,
  duplicate = false,
): Promise<SolverRunResult<{ readonly completed: true }>> {
  const payload = Uint8Array.of(value);
  const { digestArtifactPayload } = await import("../engineering/artifact-store");
  const record = await defineArtifactRecord({
    kind: "field",
    sourceRevision: request.sourceRevision,
    producer: { name: "test-fea", version: "1.0.0" },
    settingsDigest: "b".repeat(64),
    contentDigest: await digestArtifactPayload(payload),
    units: "m",
    mediaType: "application/vnd.engineering.field",
    dependencies: [
      { kind: "entity", reference: `study:${request.studyId}` },
      ...request.inputArtifacts.map(({ id }) => ({ kind: "artifact" as const, artifactId: id })),
    ],
  });
  const generated = { record, payload };
  return {
    output: { completed: true },
    truthLevel: "converged-numerical-solve",
    artifacts: duplicate ? [generated, generated] : [generated],
  };
}

export type RunGate = Readonly<{
  started: Promise<void>;
  release: (result: SolverRunResult<{ readonly completed: true }>) => void;
}>;

export function gatedAdapter(): Readonly<{
  adapter: SolverAdapter<unknown, { readonly completed: true }>;
  gate: RunGate;
  signal: () => AbortSignal | undefined;
}> {
  let start!: () => void;
  let release!: (result: SolverRunResult<{ readonly completed: true }>) => void;
  let observedSignal: AbortSignal | undefined;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const completion = new Promise<SolverRunResult<{ readonly completed: true }>>((resolve) => { release = resolve; });
  return {
    adapter: {
      capability: { kind: "fea" },
      supports: () => ({ supported: true }),
      run: async (_request, signal) => {
        observedSignal = signal;
        start();
        return completion;
      },
    },
    gate: { started, release },
    signal: () => observedSignal,
  };
}

export function immediateAdapter(
  duplicate = false,
  seen: EngineeringSolveRequest<unknown>[] = [],
  valueForRequest: (request: EngineeringSolveRequest<unknown>) => number =
    (request) => request.jobId.endsWith("two") ? 2 : 1,
): SolverAdapter<unknown, { readonly completed: true }> {
  return {
    capability: { kind: "fea" },
    supports: () => ({ supported: true }),
    async run(request) {
      seen.push(request);
      return solveResult(request, valueForRequest(request), duplicate);
    },
  };
}

export function structuralPlanner(
  calls: Array<{ readonly kind: string; readonly studyId: string }> = [],
): StudyRequestPlanner<"structural-linear"> {
  let sequence = 0;
  return async ({ document, study, artifacts }) => {
    sequence += 1;
    calls.push({ kind: study.kind, studyId: study.id });
    const exact = await exactStructuralInputs(document, artifacts);
    const request = await defineEngineeringSolveRequest({
      jobId: `workspace-job-${sequence === 1 ? "one" : "two"}`,
      kind: "fea",
      sourceRevision: document.revision,
      inputArtifacts: [exact.brep, exact.semantic, exact.voxel],
      settings: { precision: "f32" },
      studyId: study.id,
      input: {
        semanticMeshArtifactId: exact.semantic.id, semanticMeshPayload: exact.semanticPayload,
        voxelArtifactId: exact.voxel.id, voxelPayload: exact.voxelPayload,
      },
      document,
    });
    const active = new Set(artifacts.map(({ id }) => id));
    return { request, inputs: active.has(exact.voxel.id) ? [] : [{ record: exact.voxel, payload: exact.voxelPayload }] };
  };
}

export async function exactStructuralInputs(
  document: DesignDocument, activeArtifacts: readonly ArtifactRecord[] = [],
) {
  const body = document.bodies[0]!, feature = document.features[0]!;
  const selections = document.namedSelections.slice(0, 2);
  const semanticPayload: SemanticMeshPayload = {
    positionsM: new Float32Array([0, 0, 0, 0, .02, 0, 0, 0, .01, .1, 0, 0, .1, .02, 0, .1, 0, .01]),
    normals: new Float32Array([-1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    faces: selections.map(({ reference }, index) => ({
      id: reference.stableId!, bodyId: body.id,
      surfaceEvidence: { kind: "plane" as const, normal: [index ? 1 : -1, 0, 0] as [number, number, number] },
      signature: { ...reference.signature, ownerFeatureId: feature.id, kind: "face" as const,
        centroidM: [...reference.signature.centroidM] as [number, number, number],
        adjacentKinds: [...reference.signature.adjacentKinds] },
    })),
    triangleFaceIndices: new Uint32Array([0, 1]), edgePointsM: new Float32Array(),
    edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
  };
  const roots = [
    { kind: "entity" as const, reference: `document:${document.id}` as const },
    { kind: "entity" as const, reference: `feature:${feature.id}` as const },
    { kind: "entity" as const, reference: `body:${body.id}` as const },
  ];
  const brepPayload = Uint8Array.of(66, 82, 69, 80);
  const generatedBrep = await defineArtifactRecord({
    kind: "brep", sourceRevision: document.revision,
    producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: "c".repeat(64),
    contentDigest: await digestCadOutputPayload(brepPayload), units: "m",
    mediaType: "application/vnd.opencascade.brep", dependencies: roots,
  });
  const generatedSemantic = await defineArtifactRecord({
    kind: "render-mesh", sourceRevision: document.revision,
    producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: "d".repeat(64),
    contentDigest: await digestCadOutputPayload(semanticPayload), units: "m",
    mediaType: "application/vnd.structural-evolution.semantic-mesh", dependencies: roots,
  });
  const brep = activeArtifacts.find(({ kind, contentDigest }) =>
    kind === "brep" && contentDigest === generatedBrep.contentDigest) ?? generatedBrep;
  const semantic = activeArtifacts.find(({ kind, contentDigest }) =>
    kind === "render-mesh" && contentDigest === generatedSemantic.contentDigest) ?? generatedSemantic;
  const table = JSON.stringify(selections.map(({ reference }) => reference.stableId));
  const voxelPayload: StructuralVoxelPayload = {
    dimensions: new Uint32Array([2, 1, 1]), originM: new Float64Array([0, 0, 0]),
    cellSizeM: new Float64Array([.05, .05, .05]), activeCells: new Uint32Array([1, 1]),
    selectionTopologyIdsUtf8: new TextEncoder().encode(table), selectionCellOffsets: new Uint32Array([0, 1, 2]),
    selectionCellIndices: new Uint32Array([0, 1]), selectionNodeOffsets: new Uint32Array([0, 1, 2]),
    selectionNodeIndices: new Uint32Array([0, 1]), rasterizationToleranceM: new Float64Array([1e-6]),
  };
  const voxel = await defineArtifactRecord({
    kind: "solver-mesh", sourceRevision: document.revision,
    producer: { name: "occt-exact-brep-voxelizer", version: "1.0.0" }, settingsDigest: "e".repeat(64),
    contentDigest: await digestArtifactPayload(voxelPayload), units: "m", mediaType: STRUCTURAL_VOXEL_MEDIA_TYPE,
    dependencies: [{ kind: "entity", reference: `body:${body.id}` },
      { kind: "artifact", artifactId: brep.id }, { kind: "artifact", artifactId: semantic.id }],
  });
  return { brep, semantic, voxel, semanticPayload, voxelPayload };
}

export async function workspaceOptions(
  overrides: Partial<EngineeringWorkspaceOptions> = {},
): Promise<EngineeringWorkspaceOptions> {
  const document = await sourceDocument();
  const exact = await exactStructuralInputs(document);
  const registry = createSolverRegistry();
  registry.register(immediateAdapter());
  return {
    session: createDesignSession(document, [exact.brep, exact.semantic]),
    store: createArtifactStore(),
    registry,
    createCadAdapter: () => cadAdapter(async (request, _signal, emit) => emit(await cadResult(request))),
    planners: { "structural-linear": structuralPlanner() },
    clock: { now: () => "2026-09-01T10:00:00.000Z", elapsedMs: () => 1 },
    ...overrides,
  };
}

export async function artifactPayload(
  store: { get(id: string): Promise<ArtifactPayload | undefined> },
  record: ArtifactRecord,
) {
  return store.get(record.id);
}
