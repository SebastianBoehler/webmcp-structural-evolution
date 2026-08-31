import { defineArtifactRecord } from "../../cad/artifact-contract";
import { defineDesignDocument } from "../../cad/document-schema";
import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { digestCadOutputPayload, type SemanticMeshPayload } from "../../cad/rebuild-payload";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { StructuralVoxelPayload } from "../structural/structural-contract";
import type { TopologySolveInput } from "./topology-contract";

type Dims = readonly [number, number, number];
interface Selection {
  id: string;
  topologyId: string;
  centroidM: [number, number, number];
  cells: number[];
  nodes: number[];
  forceN?: [number, number, number];
}
interface Scenario {
  id: string;
  bodyId: string;
  featureId: string;
  structuralStudyId: string;
  topologyStudyId: string;
  dimensions: Dims;
  active: Uint32Array;
  support: Selection;
  loads: Selection[];
}

const cell = (dims: Dims, x: number, y: number, z: number) => x + dims[0] * (y + dims[1] * z);
const node = (dims: Dims, x: number, y: number, z: number) =>
  x + (dims[0] + 1) * (y + (dims[1] + 1) * z);
const sorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
const encode = (value: unknown) => Uint8Array.from(new TextEncoder().encode(JSON.stringify(value)));

function planeNodes(
  dims: Dims,
  axis: 0 | 1,
  coordinate: number,
  firstRange: readonly number[],
): number[] {
  const values: number[] = [];
  for (const first of firstRange) for (let z = 0; z <= dims[2]; z += 1) {
    values.push(axis === 0 ? node(dims, coordinate, first, z) : node(dims, first, coordinate, z));
  }
  return sorted(values);
}

function drone(): Scenario {
  const dimensions = [5, 5, 2] as const;
  const active = new Uint32Array(50);
  for (let z = 0; z < 2; z += 1) for (let y = 0; y < 5; y += 1) for (let x = 0; x < 5; x += 1) {
    if (x === 2 || y === 2) active[cell(dimensions, x, y, z)] = 1;
  }
  const cellsAt = (x: number, y: number) => [0, 1].map((z) => cell(dimensions, x, y, z));
  const load = (
    id: string, topologyId: string, x: number, y: number,
    nodes: number[], centroidM: [number, number, number], forceN: [number, number, number],
  ): Selection => ({ id, topologyId, cells: cellsAt(x, y), nodes, centroidM, forceN });
  return {
    id: "quad-frame", bodyId: "airframe-core", featureId: "frame-extrusion",
    structuralStudyId: "flight-loads", topologyStudyId: "mass-cut", dimensions, active,
    support: {
      id: "hub-clamp", topologyId: "skin:hub-clamp", cells: cellsAt(2, 2),
      nodes: sorted([0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1, 2]
        .map((z) => node(dimensions, x + 2, y + 2, z))))),
      centroidM: [0.025, 0.025, 0.01],
    },
    loads: [
      load("motor-east", "skin:motor-east", 4, 2, planeNodes(dimensions, 0, 5, [2, 3]), [0.05, 0.025, 0.01], [0, -100, 0]),
      load("motor-west", "skin:motor-west", 0, 2, planeNodes(dimensions, 0, 0, [2, 3]), [0, 0.025, 0.01], [0, -100, 0]),
      load("motor-north", "skin:motor-north", 2, 4, planeNodes(dimensions, 1, 5, [2, 3]), [0.025, 0.05, 0.01], [0, -100, 0]),
      load("motor-south", "skin:motor-south", 2, 0, planeNodes(dimensions, 1, 0, [2, 3]), [0.025, 0, 0.01], [0, -100, 0]),
    ],
  };
}

function cobot(): Scenario {
  const dimensions = [6, 3, 2] as const;
  const active = new Uint32Array(36);
  for (let z = 0; z < 2; z += 1) for (let y = 0; y < 3; y += 1) for (let x = 0; x < 6; x += 1) {
    if (x < 4 || y === 1) active[cell(dimensions, x, y, z)] = 1;
  }
  return {
    id: "arm-link", bodyId: "forearm-shell", featureId: "link-extrusion",
    structuralStudyId: "joint-load-case", topologyStudyId: "link-lightweighting", dimensions, active,
    support: {
      id: "joint-flange", topologyId: "patch:joint-flange",
      cells: sorted([0, 1].flatMap((z) => [0, 1, 2].map((y) => cell(dimensions, 0, y, z)))),
      nodes: planeNodes(dimensions, 0, 0, [0, 1, 2, 3]), centroidM: [0, 0.015, 0.01],
    },
    loads: [{
      id: "tool-flange", topologyId: "patch:tool-flange", forceN: [0, -1000, 0],
      cells: [cell(dimensions, 5, 1, 0), cell(dimensions, 5, 1, 1)],
      nodes: planeNodes(dimensions, 0, 6, [1, 2]), centroidM: [0.06, 0.015, 0.01],
    }],
  };
}

function semanticMesh(scenario: Scenario): SemanticMeshPayload {
  const selections = [scenario.support, ...scenario.loads];
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  selections.forEach(({ centroidM }, face) => {
    const base = positions.length / 3;
    positions.push(...centroidM, centroidM[0], centroidM[1] + 0.001, centroidM[2],
      centroidM[0], centroidM[1], centroidM[2] + 0.001);
    normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0); indices.push(base, base + 1, base + 2);
  });
  return {
    positionsM: new Float32Array(positions), normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faces: selections.map(({ topologyId, centroidM }) => ({
      id: topologyId, bodyId: scenario.bodyId,
      signature: {
        ownerFeatureId: scenario.featureId, kind: "face", geometry: "plane",
        centroidM, measureSI: 0.0001, adjacentKinds: [],
      },
    })),
    triangleFaceIndices: Uint32Array.from(selections.keys()),
    edgePointsM: new Float32Array(), edgePointRanges: new Uint32Array(),
    edges: [], polylineEdgeIndices: new Uint32Array(),
  };
}

export async function topologyScenarioRequest(kind: "drone" | "cobot") {
  const scenario = kind === "drone" ? drone() : cobot();
  const selections = [scenario.support, ...scenario.loads];
  const mesh = semanticMesh(scenario);
  const document = await defineDesignDocument({
    id: scenario.id, label: scenario.id, schemaVersion: 4,
    units: { length: "m", angle: "rad", mass: "kg" }, createdBy: { kind: "human", id: "fixture" },
    frames: [{
      id: "world", label: "World", transform: {
        position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
        orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
      },
    }],
    parameters: [], sketches: [{
      id: "footprint", plane: "frame:world", constraints: [],
      entities: [{ id: "outline", kind: "rectangle", centerM: [0.02, 0.01], sizeM: [0.1, 0.1] }],
    }],
    features: [{ id: scenario.featureId, kind: "extrude", sketchId: "footprint", distanceM: 0.02 }],
    bodies: [{ id: scenario.bodyId, featureId: scenario.featureId }], components: [], instances: [], mates: [],
    namedSelections: selections.map(({ id, topologyId, centroidM }) => ({
      id, reference: {
        bodyId: scenario.bodyId, ownerFeatureId: scenario.featureId, expectedKind: "face",
        stableId: topologyId,
        signature: { geometry: "plane", centroidM, measureSI: 0.0001, adjacentKinds: [] },
      },
    })),
    materials: [{
      id: "alloy", kind: "isotropic", densityKgM3: 2700, youngsModulusPa: 70e9,
      poissonRatio: 0.33, failureStressPa: 300e6,
    }],
    studies: [{
      id: scenario.structuralStudyId, kind: "structural-linear", bodyIds: [scenario.bodyId],
      materialId: "alloy", supports: [scenario.support.id],
      loads: scenario.loads.map(({ id, forceN }) => ({ selectionId: id, forceN: forceN! })),
    }, {
      id: scenario.topologyStudyId, kind: "topology", sourceStudyId: scenario.structuralStudyId,
      configurationState: "configured", objective: "minimum-compliance",
      targetVolumeFraction: 1, moveLimit: 0.2, filterRadiusM: 0.01, minimumFeatureM: 0.01,
      maxIterations: 2, extraction: { isoValue: 0.5, toleranceM: 1e-6 },
      protectedVoidSelectionIds: [],
      acceptance: {
        maximumDisplacementM: 1, maximumVonMisesStressPa: 1e9,
        minimumSafetyFactor: 1, maximumMaterialFraction: 1,
      },
    }],
  });
  const offsets = (groups: readonly number[][]) => Uint32Array.from([
    0, ...groups.reduce<number[]>((values, group) => [...values, values.at(-1)! + group.length], [0]).slice(1),
  ]);
  const cellGroups = selections.map(({ cells }) => sorted(cells));
  const nodeGroups = selections.map(({ nodes }) => sorted(nodes));
  const voxels: StructuralVoxelPayload = {
    dimensions: Uint32Array.from(scenario.dimensions), originM: new Float64Array([0, 0, 0]),
    cellSizeM: new Float64Array([0.01, 0.01, 0.01]), activeCells: Uint32Array.from(scenario.active),
    selectionTopologyIdsUtf8: encode(selections.map(({ topologyId }) => topologyId)),
    selectionCellOffsets: offsets(cellGroups), selectionCellIndices: Uint32Array.from(cellGroups.flat()),
    selectionNodeOffsets: offsets(nodeGroups), selectionNodeIndices: Uint32Array.from(nodeGroups.flat()),
    rasterizationToleranceM: new Float64Array([1e-6]),
  };
  const record = async (kind: "render-mesh" | "solver-mesh", mediaType: string, contentDigest: string, dependencies: unknown[]) =>
    defineArtifactRecord({
      kind, sourceRevision: document.revision, producer: { name: "scenario-fixture", version: "1" },
      settingsDigest: "a".repeat(64), contentDigest, units: "m", mediaType, dependencies,
    });
  const meshArtifact = await record("render-mesh", "application/vnd.structural-evolution.semantic-mesh",
    await digestCadOutputPayload(mesh), [{ kind: "entity", reference: `body:${scenario.bodyId}` }]);
  const voxelArtifact = await record("solver-mesh", "application/vnd.structural-evolution.voxel-domain-v1",
    await digestArtifactPayload(voxels), [
      { kind: "entity", reference: `body:${scenario.bodyId}` },
      { kind: "artifact", artifactId: meshArtifact.id },
    ]);
  const source = await defineEngineeringSolveRequest({
    jobId: `${kind}-fea`, kind: "fea", sourceRevision: document.revision,
    inputArtifacts: [meshArtifact, voxelArtifact], settings: {},
    studyId: scenario.structuralStudyId, document,
    input: {
      semanticMeshArtifactId: meshArtifact.id, semanticMeshPayload: mesh,
      voxelArtifactId: voxelArtifact.id, voxelPayload: voxels,
    },
  });
  return defineEngineeringSolveRequest<TopologySolveInput>({
    jobId: `${kind}-topology`, kind: "topology", sourceRevision: document.revision,
    inputArtifacts: source.inputArtifacts, settings: {}, studyId: scenario.topologyStudyId, document,
    input: { sourceStructuralRequest: source, initialDensity: Float32Array.from(scenario.active) },
  });
}
