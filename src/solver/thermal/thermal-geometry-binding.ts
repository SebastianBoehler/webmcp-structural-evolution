import { SemanticMeshPayloadSchema, digestCadOutputPayload } from "../../cad/rebuild-payload";
import { ArtifactRecordSchema } from "../../cad/artifact-contract";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import {
  THERMAL_VOXEL_MEDIA_TYPE, THERMAL_VOXEL_PRODUCER,
  type ThermalSolveInput, type ThermalVoxelPayload,
} from "./thermal-contract";

type Request = EngineeringSolveRequest<ThermalSolveInput>;

async function record(request: Request, id: string) {
  const artifact = request.inputArtifacts.find((candidate) => candidate.id === id);
  if (!artifact) throw new Error(`Thermal input artifact is unresolved: ${id}`);
  if (artifact.sourceRevision !== request.sourceRevision) throw new Error("Thermal input artifact has a stale source revision");
  return ArtifactRecordSchema.parseAsync(artifact);
}

function hasCoverage(artifact: Awaited<ReturnType<typeof record>>, documentId: string, bodyIds: readonly string[]): boolean {
  const bodies = artifact.dependencies.flatMap((item) => item.kind === "entity" && item.reference.startsWith("body:")
    ? [item.reference.slice(5)] : []);
  return artifact.dependencies.some((item) => item.kind === "entity" && item.reference === `document:${documentId}`)
    && bodyIds.every((id) => bodies.includes(id)) && bodies.every((id) => bodyIds.includes(id));
}

function assertPayload(payload: ThermalVoxelPayload): void {
  const fields: readonly [unknown, string][] = [
    [payload.dimensions, "Uint32Array"], [payload.originM, "Float64Array"], [payload.cellSizeM, "Float64Array"], [payload.activeCells, "Uint32Array"],
    [payload.bodyIdsUtf8, "Uint8Array"], [payload.cellBodyIndices, "Uint32Array"],
    [payload.selectionTopologyIdsUtf8, "Uint8Array"], [payload.selectionFaceOffsets, "Uint32Array"], [payload.selectionFaceCells, "Uint32Array"],
    [payload.selectionFaceAxes, "Uint8Array"], [payload.selectionFaceDirections, "Int8Array"], [payload.selectionFaceAreasM2, "Float64Array"], [payload.rasterizationToleranceM, "Float64Array"],
  ];
  for (const [value, tag] of fields) if (Object.prototype.toString.call(value) !== `[object ${tag}]`) throw new TypeError(`Thermal voxel payload must contain ${tag}`);
}

export async function validateThermalGeometry(request: Request, bodyIds: readonly string[]): Promise<void> {
  const brep = await record(request, request.input.exactBrepArtifactId);
  if (brep.kind !== "brep" || brep.mediaType !== "application/vnd.opencascade.brep" || brep.units !== "m"
    || !["occt-wasm", "workspace-exact-body-brep"].includes(brep.producer.name)
    || !hasCoverage(brep, request.document.id, bodyIds)) {
    throw new Error("Thermal study requires a revision-bound exact BREP artifact");
  }
  const semantic = await record(request, request.input.semanticMeshArtifactId);
  if (semantic.kind !== "render-mesh" || semantic.mediaType !== "application/vnd.structural-evolution.semantic-mesh" || semantic.units !== "m" || semantic.producer.name !== "occt-wasm" || !hasCoverage(semantic, request.document.id, bodyIds)) {
    throw new Error("Thermal study requires a revision-bound exact semantic-mesh artifact");
  }
  const mesh = SemanticMeshPayloadSchema.parse(request.input.semanticMeshPayload);
  if (await digestCadOutputPayload(mesh) !== semantic.contentDigest) throw new Error("Thermal semantic mesh payload does not match its content digest");
  const voxel = await record(request, request.input.thermalVoxelArtifactId);
  if (voxel.kind !== "sdf" || voxel.mediaType !== THERMAL_VOXEL_MEDIA_TYPE || voxel.units !== "m"
    || voxel.producer.name !== THERMAL_VOXEL_PRODUCER.name
    || voxel.producer.version !== THERMAL_VOXEL_PRODUCER.version
    || !hasCoverage(voxel, request.document.id, bodyIds)
    || !voxel.dependencies.some((item) => item.kind === "artifact" && item.artifactId === brep.id)
    || !voxel.dependencies.some((item) => item.kind === "artifact" && item.artifactId === semantic.id)) {
    throw new Error("Thermal study requires a derived exact artifact from the authoritative thermal voxelizer");
  }
  assertPayload(request.input.voxelPayload);
  if (await digestArtifactPayload(request.input.voxelPayload) !== voxel.contentDigest) throw new Error("Thermal voxel payload does not match its content digest");
}
