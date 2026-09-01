import { defineArtifactRecord, type ArtifactRecord } from "../../cad/artifact-contract";
import type { DesignDocument } from "../../cad/document-schema";
import { resolveNamedSelections } from "../../cad/kernel/named-selection-resolution";
import type { SemanticMeshPayload } from "../../cad/rebuild-payload";
import { revisionId } from "../../domain/revisions";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import {
  produceStructuralVoxelMesh,
} from "../structural/structural-voxelizer";
import type { StructuralExactSource } from "../structural/structural-exact-source";
import {
  THERMAL_VOXEL_MEDIA_TYPE, THERMAL_VOXEL_PRODUCER, type ThermalVoxelPayload,
} from "./thermal-contract";

export interface ThermalVoxelProducerInput {
  readonly document: DesignDocument;
  readonly bodyIds: readonly [string];
  readonly cellSizeM: number;
  readonly rasterizationToleranceM: number;
  readonly signal?: AbortSignal;
}

export interface ProducedThermalVoxelMesh {
  readonly record: ArtifactRecord;
  readonly payload: ThermalVoxelPayload;
  readonly exact: StructuralExactSource;
}

type Dims = readonly [number, number, number];
type Point = readonly [number, number, number];
const encode = (value: unknown) => Uint8Array.from(new TextEncoder().encode(JSON.stringify(value)));
const index = (dims: Dims, point: Point) => point[0] + dims[0] * (point[1] + dims[1] * point[2]);

function requiredSelectionIds(document: DesignDocument, bodyId: string): readonly string[] {
  const ids = new Set<string>();
  for (const study of document.studies) {
    if (study.kind !== "thermal-steady" || !study.bodyIds.includes(bodyId)) continue;
    for (const boundary of study.boundaries?.temperatures ?? []) ids.add(boundary.selectionId);
    for (const boundary of study.boundaries?.heatFluxes ?? []) ids.add(boundary.selectionId);
  }
  if (ids.size === 0) throw new Error("Thermal voxelization requires named thermal boundaries");
  return [...ids];
}

function plane(mesh: SemanticMeshPayload, topologyId: string) {
  const face = mesh.faces.find(({ id }) => id === topologyId);
  if (!face || face.signature.geometry !== "plane" || face.surfaceEvidence?.kind !== "plane") {
    throw new Error(`Thermal boundary ${topologyId} is not an exact planar face`);
  }
  const magnitudes = face.surfaceEvidence.normal.map(Math.abs);
  const axis = magnitudes.indexOf(Math.max(...magnitudes)) as 0 | 1 | 2;
  if (magnitudes[axis]! < 1 - 1e-9) throw new Error(`Thermal boundary ${topologyId} is not axis aligned`);
  return { axis, direction: (face.surfaceEvidence.normal[axis]! < 0 ? -1 : 1) as -1 | 1,
    coordinateM: face.signature.centroidM[axis] };
}

function rasterize(
  active: Uint32Array, dims: Dims, origin: Point, cellSizeM: number,
  toleranceM: number, surface: ReturnType<typeof plane>,
) {
  const cells: number[] = [];
  for (let z = 0; z < dims[2]; z += 1) for (let y = 0; y < dims[1]; y += 1) {
    for (let x = 0; x < dims[0]; x += 1) {
      const point: Point = [x, y, z], cell = index(dims, point);
      if (active[cell] !== 1) continue;
      const faceCoordinate = origin[surface.axis]
        + (point[surface.axis] + (surface.direction > 0 ? 1 : 0)) * cellSizeM;
      if (Math.abs(faceCoordinate - surface.coordinateM) > toleranceM) continue;
      const neighbor = [...point] as [number, number, number];
      neighbor[surface.axis] += surface.direction;
      const outside = neighbor[surface.axis] < 0 || neighbor[surface.axis] >= dims[surface.axis]
        || active[index(dims, neighbor)] !== 1;
      if (outside) cells.push(cell);
    }
  }
  if (cells.length === 0) throw new Error("Thermal named face rasterized to no active boundary faces");
  return cells;
}

export async function produceThermalVoxelMesh(
  input: ThermalVoxelProducerInput,
): Promise<ProducedThermalVoxelMesh> {
  const structural = await produceStructuralVoxelMesh(input);
  const mesh = structural.exact.semanticMeshPayload;
  const dims = [...structural.payload.dimensions] as unknown as Dims;
  const origin = [...structural.payload.originM] as unknown as Point;
  const bodyId = input.bodyIds[0], selectionIds = requiredSelectionIds(input.document, bodyId);
  const resolved = new Map(resolveNamedSelections(input.document, mesh.faces)
    .map(({ selectionId, topologyId }) => [selectionId, topologyId]));
  const topologyIds = selectionIds.map((id) => {
    const topologyId = resolved.get(id);
    if (!topologyId) throw new Error(`Thermal named selection is unresolved: ${id}`);
    return topologyId;
  });
  if (new Set(topologyIds).size !== topologyIds.length) {
    throw new Error("Thermal boundaries resolve to duplicate exact faces");
  }
  const groups = topologyIds.map((id) => rasterize(structural.payload.activeCells, dims, origin,
    input.cellSizeM, input.rasterizationToleranceM, plane(mesh, id)));
  const offsets = [0];
  for (const group of groups) offsets.push(offsets.at(-1)! + group.length);
  const faceAreaM2 = input.cellSizeM ** 2, flat = groups.flat();
  const surfaces = topologyIds.map((id) => plane(mesh, id));
  const payload: ThermalVoxelPayload = {
    dimensions: Uint32Array.from(dims), originM: Float64Array.from(origin),
    cellSizeM: new Float64Array(3).fill(input.cellSizeM),
    activeCells: new Uint32Array(structural.payload.activeCells),
    bodyIdsUtf8: encode(input.bodyIds), cellBodyIndices: new Uint32Array(structural.payload.activeCells.length),
    selectionTopologyIdsUtf8: encode(topologyIds), selectionFaceOffsets: Uint32Array.from(offsets),
    selectionFaceCells: Uint32Array.from(flat),
    selectionFaceAxes: Uint8Array.from(groups.flatMap((group, groupIndex) =>
      group.map(() => surfaces[groupIndex]!.axis))),
    selectionFaceDirections: Int8Array.from(groups.flatMap((group, groupIndex) =>
      group.map(() => surfaces[groupIndex]!.direction))),
    selectionFaceAreasM2: new Float64Array(flat.length).fill(faceAreaM2),
    rasterizationToleranceM: Float64Array.of(input.rasterizationToleranceM),
  };
  const record = await defineArtifactRecord({ kind: "sdf", sourceRevision: input.document.revision,
    producer: THERMAL_VOXEL_PRODUCER, settingsDigest: await revisionId({
      brepArtifactId: structural.exact.brepArtifact.id,
      semanticArtifactId: structural.exact.semanticArtifact.id,
      structuralClassificationArtifactId: structural.record.id,
      bodyIds: input.bodyIds, cellSizeM: input.cellSizeM,
      rasterizationToleranceM: input.rasterizationToleranceM,
    }), contentDigest: await digestArtifactPayload(payload), units: "m",
    mediaType: THERMAL_VOXEL_MEDIA_TYPE, dependencies: [
      { kind: "entity", reference: `document:${input.document.id}` },
      { kind: "entity", reference: `body:${bodyId}` },
      { kind: "artifact", artifactId: structural.exact.brepArtifact.id },
      { kind: "artifact", artifactId: structural.exact.semanticArtifact.id },
      { kind: "artifact", artifactId: structural.record.id },
    ] });
  return { record, payload, exact: structural.exact };
}
