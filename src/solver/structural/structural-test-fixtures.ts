import { defineArtifactRecord, type ArtifactRecord } from "../../cad/artifact-contract";
import { defineDesignDocument, type DesignDocument } from "../../cad/document-schema";
import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { digestCadOutputPayload, type SemanticMeshPayload } from "../../cad/rebuild-payload";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import type { StructuralSolveInput, StructuralVoxelPayload } from "./structural-contract";

const digest = (character: string) => character.repeat(64);

export async function structuralDocument(): Promise<DesignDocument> {
  return defineDesignDocument({
    id: "test-bar", label: "Test bar", schemaVersion: 3,
    units: { length: "m", angle: "rad", mass: "kg" },
    createdBy: { kind: "human", id: "tester" },
    frames: [{
      id: "world", label: "World",
      transform: {
        position: {
          x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" },
        },
        orientation: {
          roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" },
          yaw: { value: 0, unit: "rad" },
        },
      },
    }],
    parameters: [],
    sketches: [{
      id: "profile", plane: "frame:world", constraints: [],
      entities: [{ id: "outline", kind: "rectangle", centerM: [0.02, 0.01], sizeM: [0.04, 0.02] }],
    }],
    features: [{ id: "extrude", kind: "extrude", sketchId: "profile", distanceM: 0.02 }],
    bodies: [{ id: "bar", featureId: "extrude" }],
    components: [], instances: [], mates: [],
    namedSelections: [
      namedSelection("fixed-end", "face:bar:fixed", [0, 0.01, 0.01]),
      namedSelection("loaded-end", "face:bar:loaded", [0.04, 0.01, 0.01]),
    ],
    materials: [{
      id: "steel", kind: "isotropic", densityKgM3: 7850, youngsModulusPa: 200e9,
      poissonRatio: 0.3, failureStressPa: 250e6,
    }],
    studies: [{
      id: "bar-static", kind: "structural-linear", bodyIds: ["bar"], materialId: "steel",
      supports: ["fixed-end"], loads: [{ selectionId: "loaded-end", forceN: [1000, 0, 0] }],
    }],
  });
}

function namedSelection(id: string, stableId: string, centroidM: [number, number, number]) {
  return {
    id, reference: {
      bodyId: "bar", ownerFeatureId: "extrude", expectedKind: "face" as const, stableId,
      signature: { geometry: "plane" as const, centroidM, measureSI: 0.0004, adjacentKinds: [] },
    },
  };
}

export const semanticMesh: SemanticMeshPayload = {
  positionsM: new Float32Array([
    0, 0, 0, 0, 0.02, 0, 0, 0, 0.02,
    0.04, 0, 0, 0.04, 0.02, 0, 0.04, 0, 0.02,
  ]),
  normals: new Float32Array([
    -1, 0, 0, -1, 0, 0, -1, 0, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0,
  ]),
  indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
  faces: [
    semanticFace("face:bar:fixed", [0, 0.01, 0.01]),
    semanticFace("face:bar:loaded", [0.04, 0.01, 0.01]),
  ],
  triangleFaceIndices: new Uint32Array([0, 1]),
  edgePointsM: new Float32Array(), edgePointRanges: new Uint32Array(),
  edges: [], polylineEdgeIndices: new Uint32Array(),
};

function semanticFace(id: string, centroidM: [number, number, number]) {
  return {
    id, bodyId: "bar",
    signature: {
      ownerFeatureId: "extrude", kind: "face" as const, geometry: "plane" as const,
      centroidM, measureSI: 0.0004, adjacentKinds: [],
    },
  };
}

export function voxelPayload(
  overrides: Partial<StructuralVoxelPayload> = {},
): StructuralVoxelPayload {
  const topologyTable = JSON.stringify(["face:bar:fixed", "face:bar:loaded"]);
  return {
    dimensions: new Uint32Array([4, 2, 2]),
    originM: new Float64Array([0, 0, 0]),
    cellSizeM: new Float64Array([0.01, 0.01, 0.01]),
    activeCells: new Uint32Array(16).fill(1),
    selectionTopologyIdsUtf8: Uint8Array.from(topologyTable, (value) => value.charCodeAt(0)),
    selectionCellOffsets: new Uint32Array([0, 4, 8]),
    selectionCellIndices: new Uint32Array([0, 4, 8, 12, 3, 7, 11, 15]),
    selectionNodeOffsets: new Uint32Array([0, 9, 18]),
    selectionNodeIndices: new Uint32Array([
      0, 5, 10, 15, 20, 25, 30, 35, 40,
      4, 9, 14, 19, 24, 29, 34, 39, 44,
    ]),
    rasterizationToleranceM: new Float64Array([1e-6]),
    ...overrides,
  };
}

async function inputArtifact(
  document: DesignDocument,
  kind: "render-mesh" | "solver-mesh",
  mediaType: string,
  contentDigest: string,
  dependencies: readonly unknown[] = [{ kind: "entity", reference: "body:bar" }],
): Promise<ArtifactRecord> {
  return defineArtifactRecord({
    kind, sourceRevision: document.revision,
    producer: { name: "test-geometry", version: "1" }, settingsDigest: digest("a"),
    contentDigest, units: "m", mediaType,
    dependencies,
  });
}

export async function structuralRequest(
  overrides: Partial<StructuralVoxelPayload> = {},
): Promise<EngineeringSolveRequest<StructuralSolveInput>> {
  const document = await structuralDocument();
  const voxels = voxelPayload(overrides);
  const meshArtifact = await inputArtifact(
    document, "render-mesh", "application/vnd.structural-evolution.semantic-mesh",
    await digestCadOutputPayload(semanticMesh),
  );
  const voxelArtifact = await inputArtifact(
    document, "solver-mesh", "application/vnd.structural-evolution.voxel-domain-v1",
    await digestArtifactPayload(voxels),
    [
      { kind: "entity", reference: "body:bar" },
      { kind: "artifact", artifactId: meshArtifact.id },
    ],
  );
  return defineEngineeringSolveRequest({
    jobId: "bar-fea", kind: "fea", sourceRevision: document.revision,
    inputArtifacts: [meshArtifact, voxelArtifact], settings: {}, studyId: "bar-static", document,
    input: {
      semanticMeshArtifactId: meshArtifact.id, semanticMeshPayload: semanticMesh,
      voxelArtifactId: voxelArtifact.id, voxelPayload: voxels,
    },
  });
}
