import { defineArtifactRecord } from "../../cad/artifact-contract";
import { defineDesignDocument } from "../../cad/document-schema";
import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { digestCadOutputPayload, type SemanticMeshPayload } from "../../cad/rebuild-payload";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import {
  THERMAL_VOXEL_MEDIA_TYPE, THERMAL_VOXEL_PRODUCER,
  type ThermalSolveInput, type ThermalVoxelPayload,
} from "./thermal-contract";

export interface AnalyticalBody {
  readonly id: string;
  readonly materialId: string;
  readonly conductivityWmK: number;
}

export type AnalyticalBoundary = Readonly<{
  id: string;
  cellIndex: number;
  axis: 0 | 1 | 2;
  direction: -1 | 1;
  areaM2: number;
}> & ({ readonly temperatureK: number } | { readonly heatFluxWm2: number });

export interface ThermalAnalyticalRequestSpec {
  readonly dimensions: readonly [number, number, number];
  readonly cellSizeM: number;
  readonly bodies: readonly AnalyticalBody[];
  readonly cellBodyIndices: Uint32Array;
  readonly boundaries: readonly AnalyticalBoundary[];
}

const digest = (character: string) => character.repeat(64);
const utf8 = (value: unknown) => Uint8Array.from(new TextEncoder().encode(JSON.stringify(value)));

function semanticMesh(spec: ThermalAnalyticalRequestSpec): SemanticMeshPayload {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const faces = spec.boundaries.map((boundary, faceIndex) => {
    const normal = [0, 0, 0] as [number, number, number];
    normal[boundary.axis] = boundary.direction;
    const vertex = positions.length / 3;
    positions.push(faceIndex, 0, 0, faceIndex, 1, 0, faceIndex, 0, 1);
    normals.push(...normal, ...normal, ...normal);
    indices.push(vertex, vertex + 1, vertex + 2);
    const bodyId = spec.bodies[spec.cellBodyIndices[boundary.cellIndex]!]!.id;
    return {
      id: `face:${bodyId}:${boundary.id}`, bodyId,
      surfaceEvidence: { kind: "plane" as const, normal },
      signature: {
        ownerFeatureId: `feature-${bodyId}`, kind: "face" as const, geometry: "plane" as const,
        centroidM: [faceIndex, 0, 0] as [number, number, number], measureSI: boundary.areaM2,
        adjacentKinds: [],
      },
    };
  });
  return {
    positionsM: new Float32Array(positions), normals: new Float32Array(normals),
    indices: new Uint32Array(indices), faces,
    triangleFaceIndices: Uint32Array.from(faces, (_, index) => index),
    edgePointsM: new Float32Array(), edgePointRanges: new Uint32Array(),
    edges: [], polylineEdgeIndices: new Uint32Array(),
  };
}

function voxelPayload(spec: ThermalAnalyticalRequestSpec): ThermalVoxelPayload {
  const count = spec.dimensions[0] * spec.dimensions[1] * spec.dimensions[2];
  return {
    dimensions: new Uint32Array(spec.dimensions), originM: new Float64Array([0, 0, 0]),
    cellSizeM: new Float64Array([spec.cellSizeM, spec.cellSizeM, spec.cellSizeM]),
    activeCells: new Uint32Array(count).fill(1), bodyIdsUtf8: utf8(spec.bodies.map(({ id }) => id)),
    cellBodyIndices: new Uint32Array(spec.cellBodyIndices),
    selectionTopologyIdsUtf8: utf8(spec.boundaries.map((boundary) => {
      const bodyId = spec.bodies[spec.cellBodyIndices[boundary.cellIndex]!]!.id;
      return `face:${bodyId}:${boundary.id}`;
    })),
    selectionFaceOffsets: Uint32Array.from({ length: spec.boundaries.length + 1 }, (_, index) => index),
    selectionFaceCells: Uint32Array.from(spec.boundaries, ({ cellIndex }) => cellIndex),
    selectionFaceAxes: Uint8Array.from(spec.boundaries, ({ axis }) => axis),
    selectionFaceDirections: Int8Array.from(spec.boundaries, ({ direction }) => direction),
    selectionFaceAreasM2: Float64Array.from(spec.boundaries, ({ areaM2 }) => areaM2),
    rasterizationToleranceM: new Float64Array([spec.cellSizeM / 100]),
  };
}

export async function createThermalAnalyticalRequest(spec: ThermalAnalyticalRequestSpec) {
  const bodyIds = spec.bodies.map(({ id }) => id);
  const document = await defineDesignDocument({
    id: "thermal-analytical", label: "Thermal analytical fixture", schemaVersion: 6,
    units: { length: "m", angle: "rad", mass: "kg" },
    createdBy: { kind: "human", id: "thermal-gate" },
    frames: [{ id: "world", label: "World", transform: {
      position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
      orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
    } }],
    parameters: [], sketches: [{ id: "profile", plane: "frame:world", constraints: [],
      entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [1, 1] }] }],
    features: spec.bodies.map(({ id }) => ({ id: `feature-${id}`, kind: "extrude" as const, sketchId: "profile", distanceM: 1 })),
    bodies: spec.bodies.map(({ id }) => ({ id, featureId: `feature-${id}` })),
    components: [], instances: [], mates: [],
    namedSelections: spec.boundaries.map((boundary, index) => {
      const bodyId = spec.bodies[spec.cellBodyIndices[boundary.cellIndex]!]!.id;
      return { id: boundary.id, reference: {
        bodyId, ownerFeatureId: `feature-${bodyId}`, expectedKind: "face" as const,
        stableId: `face:${bodyId}:${boundary.id}`, signature: {
          geometry: "plane" as const, centroidM: [index, 0, 0] as [number, number, number],
          measureSI: boundary.areaM2, adjacentKinds: [] as const,
        },
      } };
    }),
    materials: spec.bodies.map(({ materialId, conductivityWmK }) => ({
      id: materialId, kind: "isotropic" as const, densityKgM3: 1_000,
      youngsModulusPa: 1e9, poissonRatio: 0.3, failureStressPa: 1e8, thermalConductivityWmK: conductivityWmK,
    })),
    studies: [{
      id: "thermal-study", kind: "thermal-steady", bodyIds,
      materialAssignments: spec.bodies.map(({ id, materialId }) => ({ bodyId: id, materialId })),
      boundaries: {
        temperatures: spec.boundaries.flatMap((boundary) => "temperatureK" in boundary
          ? [{ selectionId: boundary.id, temperatureK: boundary.temperatureK }] : []),
        heatFluxes: spec.boundaries.flatMap((boundary) => "heatFluxWm2" in boundary
          ? [{ selectionId: boundary.id, heatFluxWm2: boundary.heatFluxWm2 }] : []),
      },
    }],
  });
  const mesh = semanticMesh(spec), payload = voxelPayload(spec);
  const dependencies = [
    { kind: "entity" as const, reference: `document:${document.id}` as const },
    ...bodyIds.map((id) => ({ kind: "entity" as const, reference: `body:${id}` as const })),
  ];
  const brep = await defineArtifactRecord({
    kind: "brep", sourceRevision: document.revision, producer: { name: "occt-wasm", version: "4.3.2" },
    settingsDigest: digest("a"), contentDigest: digest("b"), units: "m",
    mediaType: "application/vnd.opencascade.brep", dependencies,
  });
  const semantic = await defineArtifactRecord({
    kind: "render-mesh", sourceRevision: document.revision, producer: { name: "occt-wasm", version: "4.3.2" },
    settingsDigest: digest("c"), contentDigest: await digestCadOutputPayload(mesh), units: "m",
    mediaType: "application/vnd.structural-evolution.semantic-mesh", dependencies,
  });
  const voxel = await defineArtifactRecord({
    kind: "sdf", sourceRevision: document.revision, producer: THERMAL_VOXEL_PRODUCER,
    settingsDigest: digest("d"), contentDigest: await digestArtifactPayload(payload), units: "m",
    mediaType: THERMAL_VOXEL_MEDIA_TYPE,
    dependencies: [...dependencies, { kind: "artifact", artifactId: brep.id }, { kind: "artifact", artifactId: semantic.id }],
  });
  return defineEngineeringSolveRequest<ThermalSolveInput>({
    jobId: "thermal-analytical", kind: "thermal", sourceRevision: document.revision,
    inputArtifacts: [brep, semantic, voxel], settings: {}, studyId: "thermal-study", document,
    input: { exactBrepArtifactId: brep.id, semanticMeshArtifactId: semantic.id,
      semanticMeshPayload: mesh, thermalVoxelArtifactId: voxel.id, voxelPayload: payload },
  });
}
