import { defineEngineeringSolveRequest } from "../cad/engineering-job-contract";
import type { SemanticMeshPayload } from "../cad/rebuild-payload";
import type { EngineeringSolveRequest } from "../engineering/solver-adapter";
import {
  authoritativeComponentIntent, type AuthoritativeComponentDocument,
} from "../models/component-documents";
import type { MechanismAdapterInput } from "../simulation/mechanism-adapter";
import {
  COMPONENT_STRUCTURAL_PCG_ITERATION_BUDGET, type StructuralSolveInput,
} from "../solver/structural/structural-contract";
import { produceStructuralVoxelMeshFromExact } from "../solver/structural/structural-voxelizer";
import type { ThermalSolveInput } from "../solver/thermal/thermal-contract";
import { produceThermalVoxelMeshFromExact } from "../solver/thermal/thermal-voxelizer";
import type { TopologySolveInput } from "../solver/topology/topology-contract";
import { compileExactComponentMechanism } from "./component-mechanism-compiler";
import type {
  StudyCompilation, StudyRequestPlanner, StudyRequestPlanners,
} from "./workspace-study-plan";

export type ComponentPlannerAuthority = Readonly<{
  documentId: string;
  documentRevision: string;
  intentDigest: string;
}>;
const plannerAuthorities = new WeakMap<Function, ComponentPlannerAuthority>();
export const componentPlannerAuthority = (
  planner: Function,
): ComponentPlannerAuthority | undefined => plannerAuthorities.get(planner);

function ownedPlanner<Kind extends Parameters<StudyRequestPlanner<any>>[0]["study"]["kind"]>(
  planner: StudyRequestPlanner<Kind>, authority: ComponentPlannerAuthority,
): StudyRequestPlanner<Kind> {
  plannerAuthorities.set(planner, authority);
  return planner;
}

function gridSize(mesh: SemanticMeshPayload, bodyIds: readonly string[]): number {
  const bodies = new Set(bodyIds), used = new Set<number>();
  mesh.triangleFaceIndices.forEach((faceIndex, triangle) => {
    if (!bodies.has(mesh.faces[faceIndex]!.bodyId)) return;
    used.add(mesh.indices[triangle * 3]!);
    used.add(mesh.indices[triangle * 3 + 1]!);
    used.add(mesh.indices[triangle * 3 + 2]!);
  });
  const bounds = [0, 1, 2].map((axis) => {
    const values = [...used].map((index) => mesh.positionsM[index * 3 + axis]!);
    return Math.max(...values) - Math.min(...values);
  });
  const extent = Math.max(...bounds);
  if (!(extent > 0) || !Number.isFinite(extent)) throw new Error("Component planner exact extent is invalid");
  return Math.fround(extent / 42);
}

const jobId = (kind: string) => `component-${kind}-${crypto.randomUUID()}`;
const exactVoxelSource = (
  exact: Awaited<ReturnType<Parameters<StudyRequestPlanner<any>>[0]["exactSource"]>>, bodyId: string,
) => ({
  brepArtifact: exact.bodyBreps[bodyId]!.artifact, brepPayload: exact.bodyBreps[bodyId]!.payload,
  semanticArtifact: exact.semanticArtifact, semanticMeshPayload: exact.semanticMeshPayload,
});

function assertModel(model: AuthoritativeComponentDocument, documentId: string, revision: string): void {
  if (model.document.id !== documentId || model.document.revision !== revision) {
    throw new Error("Component planner is not bound to the active authoritative document");
  }
}

async function structuralCompilation(
  model: AuthoritativeComponentDocument,
  input: Parameters<StudyRequestPlanner<"structural-linear">>[0],
): Promise<StudyCompilation> {
  assertModel(model, input.document.id, input.document.revision);
  const exact = await input.exactSource();
  const cellSizeM = gridSize(exact.semanticMeshPayload, input.study.bodyIds);
  const voxel = await produceStructuralVoxelMeshFromExact({ document: input.document,
    bodyIds: input.study.bodyIds, cellSizeM, rasterizationToleranceM: cellSizeM * 1e-4,
    ...exactVoxelSource(exact, input.study.bodyIds[0]!) });
  const bodyBrep = exact.bodyBreps[input.study.bodyIds[0]!]!.artifact;
  const request = await defineEngineeringSolveRequest<StructuralSolveInput>({
    jobId: jobId("structural"), kind: "fea", sourceRevision: input.document.revision,
    inputArtifacts: [...exact.artifacts, bodyBrep, voxel.record],
    settings: { pcgIterationBudget: COMPONENT_STRUCTURAL_PCG_ITERATION_BUDGET },
    studyId: input.study.id, document: input.document,
    input: { semanticMeshArtifactId: exact.semanticArtifact.id,
      semanticMeshPayload: exact.semanticMeshPayload,
      voxelArtifactId: voxel.record.id, voxelPayload: voxel.payload },
  });
  return { request, inputs: [{ record: voxel.record, payload: voxel.payload }] };
}

function structuralStudyForTopology(
  document: Parameters<StudyRequestPlanner<"topology">>[0]["document"], sourceStudyId: string,
) {
  const study = document.studies.find(({ id }) => id === sourceStudyId);
  if (!study || study.kind !== "structural-linear") throw new Error("Topology source structural study is unresolved");
  return study;
}

async function topologyCompilation(
  model: AuthoritativeComponentDocument,
  input: Parameters<StudyRequestPlanner<"topology">>[0],
): Promise<StudyCompilation> {
  assertModel(model, input.document.id, input.document.revision);
  if (input.study.configurationState !== "configured") throw new Error("Component topology study is not configured");
  const study = structuralStudyForTopology(input.document, input.study.sourceStudyId);
  const exact = await input.exactSource(), cellSizeM = gridSize(exact.semanticMeshPayload, study.bodyIds);
  const voxel = await produceStructuralVoxelMeshFromExact({ document: input.document,
    bodyIds: study.bodyIds, cellSizeM, rasterizationToleranceM: cellSizeM * 1e-4,
    ...exactVoxelSource(exact, study.bodyIds[0]!) });
  const bodyBrep = exact.bodyBreps[study.bodyIds[0]!]!.artifact;
  const source = await defineEngineeringSolveRequest<StructuralSolveInput>({
    jobId: jobId("topology-source"), kind: "fea", sourceRevision: input.document.revision,
    inputArtifacts: [...exact.artifacts, bodyBrep, voxel.record],
    settings: { pcgIterationBudget: COMPONENT_STRUCTURAL_PCG_ITERATION_BUDGET }, studyId: study.id,
    document: input.document, input: { semanticMeshArtifactId: exact.semanticArtifact.id,
      semanticMeshPayload: exact.semanticMeshPayload,
      voxelArtifactId: voxel.record.id, voxelPayload: voxel.payload },
  });
  const initialDensity = Float32Array.from(voxel.payload.activeCells);
  const request = await defineEngineeringSolveRequest<TopologySolveInput>({
    jobId: jobId("topology"), kind: "topology", sourceRevision: input.document.revision,
    inputArtifacts: [...exact.artifacts, bodyBrep, voxel.record], settings: {}, studyId: input.study.id,
    document: input.document, input: { sourceStructuralRequest: source, initialDensity },
  });
  return { request, inputs: [{ record: voxel.record, payload: voxel.payload }] };
}

async function thermalCompilation(
  model: AuthoritativeComponentDocument,
  input: Parameters<StudyRequestPlanner<"thermal-steady">>[0],
): Promise<StudyCompilation> {
  assertModel(model, input.document.id, input.document.revision);
  if (input.study.bodyIds.length !== 1) throw new Error("Component thermal planner requires one exact body");
  const exact = await input.exactSource(), cellSizeM = gridSize(exact.semanticMeshPayload, input.study.bodyIds);
  const voxel = await produceThermalVoxelMeshFromExact({ document: input.document,
    bodyIds: [input.study.bodyIds[0]!], cellSizeM, rasterizationToleranceM: cellSizeM * 1e-4,
    ...exactVoxelSource(exact, input.study.bodyIds[0]!) });
  const bodyBrep = exact.bodyBreps[input.study.bodyIds[0]!]!.artifact;
  const request = await defineEngineeringSolveRequest<ThermalSolveInput>({
    jobId: jobId("thermal"), kind: "thermal", sourceRevision: input.document.revision,
    inputArtifacts: [...exact.artifacts, bodyBrep, voxel.structural.record, voxel.record],
    settings: {}, studyId: input.study.id,
    document: input.document, input: { exactBrepArtifactId: bodyBrep.id,
      semanticMeshArtifactId: exact.semanticArtifact.id,
      semanticMeshPayload: exact.semanticMeshPayload,
      thermalVoxelArtifactId: voxel.record.id, voxelPayload: voxel.payload },
  });
  return { request, inputs: [
    { record: voxel.structural.record, payload: voxel.structural.payload },
    { record: voxel.record, payload: voxel.payload },
  ] };
}

async function mechanismCompilation(
  model: AuthoritativeComponentDocument,
  input: Parameters<StudyRequestPlanner<"mechanism">>[0],
): Promise<StudyCompilation> {
  assertModel(model, input.document.id, input.document.revision);
  const exact = await input.exactSource();
  const compiled = await compileExactComponentMechanism(model, exact);
  const request = await defineEngineeringSolveRequest<MechanismAdapterInput>({
    jobId: jobId("mechanism"), kind: "mechanism", sourceRevision: input.document.revision,
    inputArtifacts: [...exact.artifacts, exact.bodyDynamicsArtifact], settings: {}, studyId: input.study.id,
    document: input.document, input: { schemaVersion: 1, mechanismInput: compiled.input },
  });
  return { request, inputs: [] };
}

export function createComponentStudyPlanners(
  model: AuthoritativeComponentDocument,
): StudyRequestPlanners {
  const authority = { documentId: model.document.id, documentRevision: model.document.revision,
    intentDigest: authoritativeComponentIntent(model) };
  const kinds = new Set(model.document.studies.map(({ kind }) => kind));
  return {
    ...(kinds.has("structural-linear") ? { "structural-linear": ownedPlanner((input) => structuralCompilation(model, input), authority) } : {}),
    ...(kinds.has("topology") ? { topology: ownedPlanner((input) => topologyCompilation(model, input), authority) } : {}),
    ...(kinds.has("thermal-steady") ? { "thermal-steady": ownedPlanner((input) => thermalCompilation(model, input), authority) } : {}),
    ...(kinds.has("mechanism") ? { mechanism: ownedPlanner((input) => mechanismCompilation(model, input), authority) } : {}),
  };
}
