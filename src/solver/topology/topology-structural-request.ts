import { defineArtifactRecord, type ArtifactRecord } from "../../cad/artifact-contract";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import { revisionId } from "../../domain/revisions";
import type { StructuralSolveInput, StructuralVoxelPayload } from "../structural/structural-contract";

function clonedVoxel(source: StructuralVoxelPayload, activeCells: Uint32Array): StructuralVoxelPayload {
  return {
    dimensions: new Uint32Array(source.dimensions),
    originM: new Float64Array(source.originM), cellSizeM: new Float64Array(source.cellSizeM),
    activeCells: new Uint32Array(activeCells),
    selectionTopologyIdsUtf8: new Uint8Array(source.selectionTopologyIdsUtf8),
    selectionCellOffsets: new Uint32Array(source.selectionCellOffsets),
    selectionCellIndices: new Uint32Array(source.selectionCellIndices),
    selectionNodeOffsets: new Uint32Array(source.selectionNodeOffsets),
    selectionNodeIndices: new Uint32Array(source.selectionNodeIndices),
    rasterizationToleranceM: new Float64Array(source.rasterizationToleranceM),
  };
}

export async function structuralRequestForTopologyMask(
  source: EngineeringSolveRequest<StructuralSolveInput>,
  activeCells: Uint32Array,
  stage: string,
  extractedMesh?: ArtifactRecord,
  outerOwnerStudyId?: string,
): Promise<Readonly<{
  request: EngineeringSolveRequest<StructuralSolveInput>;
  voxelArtifact: ArtifactRecord;
  maskDigest: string;
}>> {
  const voxelPayload = clonedVoxel(source.input.voxelPayload, activeCells);
  const contentDigest = await digestArtifactPayload(voxelPayload);
  const original = source.inputArtifacts.find(({ id }) => id === source.input.voxelArtifactId);
  if (!original) throw new Error("Topology source voxel artifact is unresolved");
  const semanticId = source.input.semanticMeshArtifactId;
  const entityDependencies = original.dependencies.filter((dependency) => dependency.kind === "entity");
  const outerOwner = outerOwnerStudyId && !entityDependencies.some(
    (dependency) => dependency.reference === `study:${outerOwnerStudyId}`,
  ) ? [{ kind: "entity" as const, reference: `study:${outerOwnerStudyId}` }] : [];
  const dependencies = [
    ...entityDependencies, ...outerOwner,
    { kind: "artifact" as const, artifactId: semanticId },
    ...(extractedMesh ? [{ kind: "artifact" as const, artifactId: extractedMesh.id }] : []),
  ];
  const voxelArtifact = await defineArtifactRecord({
    kind: "solver-mesh", sourceRevision: source.sourceRevision,
    producer: { name: "webgpu-topology-rasterizer", version: "1.0.0" },
    settingsDigest: await revisionId({ stage, activeMaskDigest: contentDigest }),
    contentDigest, units: "m", mediaType: original.mediaType, dependencies,
  });
  const inputArtifacts = source.inputArtifacts
    .filter(({ id }) => id !== source.input.voxelArtifactId && id !== extractedMesh?.id)
    .concat(extractedMesh ? [extractedMesh, voxelArtifact] : [voxelArtifact]);
  return {
    maskDigest: await digestArtifactPayload({ activeCells }), voxelArtifact,
    request: {
      ...source, jobId: `${source.jobId}:${stage}`, inputArtifacts,
      input: { ...source.input, voxelArtifactId: voxelArtifact.id, voxelPayload },
    },
  };
}
