import { resolveNamedSelections } from "../../cad/kernel/named-selection-resolution";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import {
  DEFAULT_STRUCTURAL_COMPILE_LIMITS,
  type CompiledStructuralSystem,
  type StructuralCompileLimits,
  type StructuralSolveInput,
} from "./structural-contract";
import {
  activeCells, activeComponents, dimensions, origin, uniformCellSize,
} from "./structural-grid-validation";
import { validateStructuralPayloads } from "./structural-payload-validation";
import { validateStructuralGeometryBinding } from "./structural-geometry-binding";
import { selectionGroups, type SelectionGroup } from "./structural-selection-groups";

type DocumentStructuralStudy = Extract<
  EngineeringSolveRequest<StructuralSolveInput>["document"]["studies"][number],
  { readonly kind: "structural-linear" }
>;

function structuralStudy(request: EngineeringSolveRequest<StructuralSolveInput>): DocumentStructuralStudy {
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  if (!study || study.kind !== "structural-linear") {
    throw new Error(`Structural study is unresolved or has the wrong kind: ${request.studyId}`);
  }
  return study;
}

function selectedTopologies(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  study: DocumentStructuralStudy,
): readonly Readonly<{ selectionId: string; topologyId: string }>[] {
  const requiredIds = [...study.supports, ...study.loads.map(({ selectionId }) => selectionId)];
  for (const id of requiredIds) {
    const selection = request.document.namedSelections.find((candidate) => candidate.id === id);
    if (!selection || selection.reference.expectedKind !== "face") {
      throw new Error(`Structural boundary selection must resolve to an exact face: ${id}`);
    }
  }
  const resolved = new Map(resolveNamedSelections(
    request.document, request.input.semanticMeshPayload.faces,
  ).map(({ selectionId, topologyId }) => [selectionId, topologyId]));
  return requiredIds.map((selectionId) => ({
    selectionId,
    topologyId: resolved.get(selectionId) ?? (() => { throw new Error(`Named selection is unresolved: ${selectionId}`); })(),
  }));
}

function ensureLoadedIslandsSupported(
  groups: readonly SelectionGroup[],
  supportCount: number,
  components: Int32Array,
): void {
  const supported = new Set<number>();
  for (const group of groups.slice(0, supportCount)) {
    for (const cell of group.cellIndices) supported.add(components[cell]!);
  }
  for (const group of groups.slice(supportCount)) {
    for (const cell of group.cellIndices) {
      if (!supported.has(components[cell]!)) {
        throw new Error(`Loaded island ${group.selectionId} has no connected support`);
      }
    }
  }
}

function boundaryVectors(
  groups: readonly SelectionGroup[],
  study: DocumentStructuralStudy,
  dofCount: number,
): { fixedDofs: Uint32Array; loadsN: Float32Array } {
  const fixedDofs = new Uint32Array(dofCount);
  for (const group of groups.slice(0, study.supports.length)) {
    for (const node of group.nodeIndices) fixedDofs.fill(1, node * 3, node * 3 + 3);
  }
  const loadsN = new Float32Array(dofCount);
  for (const [loadIndex, load] of study.loads.entries()) {
    const group = groups[study.supports.length + loadIndex]!;
    for (const node of group.nodeIndices) for (let axis = 0; axis < 3; axis += 1) {
      loadsN[node * 3 + axis] += load.forceN[axis]! / group.nodeIndices.length;
    }
  }
  return { fixedDofs, loadsN };
}

export async function compileStructuralStudy(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  limits: StructuralCompileLimits = DEFAULT_STRUCTURAL_COMPILE_LIMITS,
): Promise<CompiledStructuralSystem> {
  await validateStructuralPayloads(request);
  const study = structuralStudy(request);
  const material = request.document.materials.find(({ id }) => id === study.materialId);
  if (!material || material.kind !== "isotropic" || material.youngsModulusPa > 1e13
    || material.poissonRatio <= -0.99 || material.poissonRatio >= 0.49) {
    throw new Error("Structural adapter supports bounded finite isotropic materials only");
  }
  const payload = request.input.voxelPayload;
  const cellDimensions = dimensions(payload);
  const cellCount = cellDimensions[0] * cellDimensions[1] * cellDimensions[2];
  if (!Number.isSafeInteger(cellCount) || cellCount > limits.maxCells) {
    throw new Error(`Structural grid cell limit exceeded: ${cellCount} > ${limits.maxCells}`);
  }
  const nodeDimensions = cellDimensions.map((value) => value + 1) as [number, number, number];
  const nodeCount = nodeDimensions[0] * nodeDimensions[1] * nodeDimensions[2];
  const dofCount = nodeCount * 3;
  if (!Number.isSafeInteger(dofCount) || dofCount > limits.maxDofs) {
    throw new Error(`Structural grid degree-of-freedom limit exceeded: ${dofCount} > ${limits.maxDofs}`);
  }
  const active = activeCells(payload, cellCount);
  const selected = selectedTopologies(request, study);
  const supportTopologies = new Set(selected.slice(0, study.supports.length).map(({ topologyId }) => topologyId));
  const overlap = selected.slice(study.supports.length).find(({ topologyId }) => supportTopologies.has(topologyId));
  if (overlap) throw new Error(`Structural load and support cannot occupy the same face: ${overlap.selectionId}`);
  validateStructuralGeometryBinding(request, study, selected.map(({ topologyId }) => topologyId));
  const groups = await selectionGroups(
    payload, selected, cellCount, nodeCount, active, cellDimensions,
  );
  ensureLoadedIslandsSupported(groups, study.supports.length, activeComponents(active, cellDimensions));
  const { fixedDofs, loadsN } = boundaryVectors(groups, study, dofCount);
  if (!loadsN.some((value, dof) => value !== 0 && fixedDofs[dof] === 0)) {
    throw new Error("Structural study applies no load to a free degree of freedom");
  }
  const toleranceM = payload.rasterizationToleranceM[0];
  if (payload.rasterizationToleranceM.length !== 1 || !Number.isFinite(toleranceM) || toleranceM! <= 0
    || toleranceM! > uniformCellSize(payload) * 0.5) {
    throw new Error("Structural rasterization tolerance must be finite, positive, and at most half a cell");
  }
  return {
    sourceRevision: request.sourceRevision, studyId: study.id, bodyIds: [...study.bodyIds],
    consumedArtifactIds: [request.input.semanticMeshArtifactId, request.input.voxelArtifactId],
    grid: {
      cellDimensions, nodeDimensions, originM: origin(payload), cellSizeM: uniformCellSize(payload),
    },
    activeCells: active, activeCellCount: active.filter(Boolean).length,
    fixedDofs, loadsN,
    material: {
      youngsModulusPa: material.youngsModulusPa,
      poissonRatio: material.poissonRatio,
      failureStressPa: material.failureStressPa,
    },
    rasterization: {
      toleranceM: toleranceM!,
      selections: groups.map(({ cellIndices: _cells, nodeIndices: _nodes, ...selection }) => selection),
    },
  };
}
