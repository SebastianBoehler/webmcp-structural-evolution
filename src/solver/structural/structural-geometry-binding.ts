import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import type { StructuralSolveInput } from "./structural-contract";

type StructuralStudy = Extract<
  EngineeringSolveRequest<StructuralSolveInput>["document"]["studies"][number],
  { readonly kind: "structural-linear" }
>;

export function validateStructuralGeometryBinding(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  study: StructuralStudy,
  selectedTopologyIds: readonly string[],
): void {
  const voxel = request.inputArtifacts.find(({ id }) => id === request.input.voxelArtifactId);
  if (!voxel) throw new Error("Structural solver-mesh artifact is unresolved");
  const bodyReferences = voxel.dependencies.flatMap((dependency) =>
    dependency.kind === "entity" && dependency.reference.startsWith("body:")
      ? [dependency.reference.slice("body:".length)] : []);
  for (const bodyId of study.bodyIds) {
    if (!bodyReferences.includes(bodyId)) {
      throw new Error(`Structural solver-mesh is not bound to study body: ${bodyId}`);
    }
  }
  const studyBodies = new Set(study.bodyIds);
  const foreign = bodyReferences.find((bodyId) => !studyBodies.has(bodyId));
  if (foreign) throw new Error(`Structural solver-mesh contains a foreign body dependency: ${foreign}`);
  if (!voxel.dependencies.some((dependency) =>
    dependency.kind === "artifact" && dependency.artifactId === request.input.semanticMeshArtifactId)) {
    throw new Error("Structural solver-mesh must depend on its consumed exact semantic-mesh artifact");
  }

  const faceIndex = new Map(request.input.semanticMeshPayload.faces.map(({ id }, index) => [id, index]));
  const ownedFaces = new Set(request.input.semanticMeshPayload.triangleFaceIndices);
  for (const topologyId of selectedTopologyIds) {
    const index = faceIndex.get(topologyId);
    if (index === undefined || !ownedFaces.has(index)) {
      throw new Error(`Structural selected face has no exact semantic triangle ownership: ${topologyId}`);
    }
  }
}
