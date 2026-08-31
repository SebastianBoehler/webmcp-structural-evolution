import type { ArtifactRecord } from "../../cad/artifact-contract";
import { digestCadOutputPayload, SemanticMeshPayloadSchema } from "../../cad/rebuild-payload";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import {
  STRUCTURAL_VOXEL_MEDIA_TYPE,
  type StructuralSolveInput,
  type StructuralVoxelPayload,
} from "./structural-contract";

function artifact(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  id: string,
): ArtifactRecord {
  const record = request.inputArtifacts.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Structural input artifact is unresolved: ${id}`);
  if (record.sourceRevision !== request.sourceRevision) {
    throw new Error(`Structural input artifact has a stale source revision: ${id}`);
  }
  return record;
}

function typedArray(value: unknown, tag: string, name: string): void {
  if (Object.prototype.toString.call(value) !== `[object ${tag}]`) {
    throw new TypeError(`Structural voxel payload ${name} must be a ${tag}`);
  }
}

export function validateVoxelPayloadShape(value: StructuralVoxelPayload): void {
  typedArray(value.dimensions, "Uint32Array", "dimensions");
  typedArray(value.originM, "Float64Array", "originM");
  typedArray(value.cellSizeM, "Float64Array", "cellSizeM");
  typedArray(value.activeCells, "Uint32Array", "activeCells");
  typedArray(value.selectionTopologyIdsUtf8, "Uint8Array", "selectionTopologyIdsUtf8");
  typedArray(value.selectionCellOffsets, "Uint32Array", "selectionCellOffsets");
  typedArray(value.selectionCellIndices, "Uint32Array", "selectionCellIndices");
  typedArray(value.selectionNodeOffsets, "Uint32Array", "selectionNodeOffsets");
  typedArray(value.selectionNodeIndices, "Uint32Array", "selectionNodeIndices");
  typedArray(value.rasterizationToleranceM, "Float64Array", "rasterizationToleranceM");
}

export async function validateStructuralPayloads(
  request: EngineeringSolveRequest<StructuralSolveInput>,
): Promise<void> {
  const semantic = artifact(request, request.input.semanticMeshArtifactId);
  if (semantic.kind !== "render-mesh"
    || semantic.mediaType !== "application/vnd.structural-evolution.semantic-mesh") {
    throw new Error("Structural study requires an exact semantic-mesh artifact");
  }
  const parsedSemantic = SemanticMeshPayloadSchema.parse(request.input.semanticMeshPayload);
  if (await digestCadOutputPayload(parsedSemantic) !== semantic.contentDigest) {
    throw new Error("Semantic mesh payload does not match its content digest");
  }

  const voxels = artifact(request, request.input.voxelArtifactId);
  if (voxels.kind !== "solver-mesh" || voxels.mediaType !== STRUCTURAL_VOXEL_MEDIA_TYPE) {
    throw new Error(`Structural study requires a ${STRUCTURAL_VOXEL_MEDIA_TYPE} solver-mesh artifact`);
  }
  validateVoxelPayloadShape(request.input.voxelPayload);
  if (await digestArtifactPayload(request.input.voxelPayload) !== voxels.contentDigest) {
    throw new Error("Structural voxel payload does not match its content digest");
  }
}
