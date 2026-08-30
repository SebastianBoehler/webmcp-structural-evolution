import type { OcctKernel, ShapeHandle } from "occt-wasm";

import type { SemanticMeshPayload, SemanticTopology } from "../rebuild-payload";
import {
  sameTopologyGeometry,
  topologyGeometryKey,
  type TopologySignature,
} from "./persistent-references";

const HASH_UPPER_BOUND = 2_147_483_647;
export const SEMANTIC_LINEAR_DEFLECTION_M = 1e-4;
export const SEMANTIC_ANGULAR_DEFLECTION_RAD = 0.25;

export interface RebuiltFeatureShape {
  readonly id: string;
  readonly shape: ShapeHandle;
}

export interface RebuiltBodyShape {
  readonly id: string;
  readonly terminalFeatureId: string;
  readonly lineageFeatureIds: readonly string[];
  readonly shape: ShapeHandle;
}

interface HashedSignature {
  readonly hash: number;
  readonly signature: TopologySignature;
}

interface CollectedTopology {
  readonly faces: readonly HashedSignature[];
  readonly edges: readonly HashedSignature[];
}

const geometryForSurface = (value: string): TopologySignature["geometry"] =>
  value === "plane" || value === "cylinder" || value === "cone" || value === "sphere"
    ? value
    : "other";

function edgeFaces(kernel: OcctKernel, shape: ShapeHandle): Map<number, number[]> {
  const flat = kernel.edgeToFaceMap(shape, HASH_UPPER_BOUND);
  const result = new Map<number, number[]>();
  for (let index = 0; index < flat.length;) {
    const edgeHash = flat[index++]!;
    const count = flat[index++]!;
    const hashes = flat.slice(index, index + count);
    index += count;
    const existing = result.get(edgeHash) ?? [];
    result.set(edgeHash, [...new Set([...existing, ...hashes])]);
  }
  return result;
}

function collectTopology(
  kernel: OcctKernel,
  shape: ShapeHandle,
  ownerFeatureId: string,
): CollectedTopology {
  const faces = kernel.getSubShapes(shape, "face");
  const faceKinds = new Map<number, string>();
  for (const face of faces) {
    faceKinds.set(kernel.hashCode(face, HASH_UPPER_BOUND), kernel.surfaceType(face));
  }
  const faceSignatures = faces.map((face): HashedSignature => {
    const center = kernel.getSurfaceCenterOfMass(face);
    const adjacentKinds = kernel.adjacentFaces(shape, face).map((adjacent) => kernel.surfaceType(adjacent)).sort();
    return {
      hash: kernel.hashCode(face, HASH_UPPER_BOUND),
      signature: {
        ownerFeatureId,
        kind: "face",
        geometry: geometryForSurface(kernel.surfaceType(face)),
        centroidM: [center.x, center.y, center.z],
        measureSI: kernel.getSurfaceArea(face),
        adjacentKinds,
      },
    };
  });
  const adjacency = edgeFaces(kernel, shape);
  const edgeSignatures = kernel.getSubShapes(shape, "edge").map((edge): HashedSignature => {
    const hash = kernel.hashCode(edge, HASH_UPPER_BOUND);
    const center = kernel.getLinearCenterOfMass(edge);
    return {
      hash,
      signature: {
        ownerFeatureId,
        kind: "edge",
        geometry: "curve",
        centroidM: [center.x, center.y, center.z],
        measureSI: kernel.curveLength(edge),
        adjacentKinds: (adjacency.get(hash) ?? []).map((faceHash) => faceKinds.get(faceHash) ?? "other").sort(),
      },
    };
  });
  return { faces: faceSignatures, edges: edgeSignatures };
}

function assignOwner(
  signature: TopologySignature,
  lineageFeatureIds: readonly string[],
  featureTopology: ReadonlyMap<string, CollectedTopology>,
): string {
  for (const featureId of lineageFeatureIds) {
    const candidates = signature.kind === "face"
      ? featureTopology.get(featureId)?.faces
      : featureTopology.get(featureId)?.edges;
    if (candidates?.filter((candidate) => sameTopologyGeometry(signature, candidate.signature)).length === 1) {
      return featureId;
    }
  }
  return signature.ownerFeatureId;
}

function semanticRecords(
  topology: readonly HashedSignature[],
  body: RebuiltBodyShape,
  featureTopology: ReadonlyMap<string, CollectedTopology>,
): { readonly records: SemanticTopology[]; readonly indexByHash: ReadonlyMap<number, number> } {
  const owned = topology.map(({ hash, signature }) => ({
    hash,
    signature: {
      ...signature,
      ownerFeatureId: assignOwner(signature, body.lineageFeatureIds, featureTopology),
      centroidM: [...signature.centroidM] as [number, number, number],
      adjacentKinds: [...signature.adjacentKinds],
    },
  }));
  const occurrences = new Map<string, number>();
  const records = owned.map(({ signature }) => {
    const base = `${signature.kind}:${body.id}:${signature.ownerFeatureId}:${topologyGeometryKey(signature)}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return { id: occurrence === 0 ? base : `${base}:${occurrence}`, bodyId: body.id, signature };
  });
  const indexByHash = new Map<number, number>();
  owned.forEach(({ hash }, index) => {
    if (indexByHash.has(hash)) throw new Error(`OCCT topology hash collision in body: ${body.id}`);
    indexByHash.set(hash, index);
  });
  return { records, indexByHash };
}

const concatFloat32 = (values: readonly Float32Array[]) => {
  const result = new Float32Array(values.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
};

export function tessellateSemanticBodies(
  kernel: OcctKernel,
  features: readonly RebuiltFeatureShape[],
  bodies: readonly RebuiltBodyShape[],
): SemanticMeshPayload {
  const featureTopology = new Map(features.map((feature) => [
    feature.id,
    collectTopology(kernel, feature.shape, feature.id),
  ]));
  const positionParts: Float32Array[] = [];
  const normalParts: Float32Array[] = [];
  const indexValues: number[] = [];
  const triangleFaceIndices: number[] = [];
  const edgePointParts: Float32Array[] = [];
  const edgePointRanges: number[] = [];
  const polylineEdgeIndices: number[] = [];
  const allFaces: SemanticTopology[] = [];
  const allEdges: SemanticTopology[] = [];
  let vertexOffset = 0;
  let edgePointOffset = 0;

  for (const body of bodies) {
    const topology = collectTopology(kernel, body.shape, body.terminalFeatureId);
    const faces = semanticRecords(topology.faces, body, featureTopology);
    const edges = semanticRecords(topology.edges, body, featureTopology);
    const faceOffset = allFaces.length;
    const edgeOffset = allEdges.length;
    allFaces.push(...faces.records);
    allEdges.push(...edges.records);

    const mesh = kernel.meshShape(body.shape, {
      linearDeflection: SEMANTIC_LINEAR_DEFLECTION_M,
      angularDeflection: SEMANTIC_ANGULAR_DEFLECTION_RAD,
      relative: false,
    });
    if (!mesh.faceGroups) throw new Error(`OCCT tessellation omitted face groups: ${body.id}`);
    positionParts.push(mesh.positions);
    normalParts.push(mesh.normals);
    indexValues.push(...mesh.indices.map((index) => index + vertexOffset));
    const localOwners = new Array<number>(mesh.triangleCount).fill(-1);
    for (let index = 0; index < mesh.faceGroups.length; index += 3) {
      const start = mesh.faceGroups[index]! / 3;
      const count = mesh.faceGroups[index + 1]! / 3;
      const owner = faces.indexByHash.get(mesh.faceGroups[index + 2]!);
      if (owner === undefined) throw new Error(`Tessellated face has no semantic owner: ${body.id}`);
      localOwners.fill(faceOffset + owner, start, start + count);
    }
    if (localOwners.some((owner) => owner < 0)) throw new Error(`Triangle has no semantic owner: ${body.id}`);
    triangleFaceIndices.push(...localOwners);
    vertexOffset += mesh.vertexCount;

    const wireframe = kernel.wireframe(body.shape, SEMANTIC_LINEAR_DEFLECTION_M);
    edgePointParts.push(wireframe.points);
    for (let index = 0; index < wireframe.edgeGroups.length; index += 3) {
      const owner = edges.indexByHash.get(wireframe.edgeGroups[index + 2]!);
      if (owner === undefined) throw new Error(`Tessellated edge has no semantic owner: ${body.id}`);
      edgePointRanges.push(
        edgePointOffset + wireframe.edgeGroups[index]! / 3,
        wireframe.edgeGroups[index + 1]! / 3,
      );
      polylineEdgeIndices.push(edgeOffset + owner);
    }
    edgePointOffset += wireframe.points.length / 3;
  }

  return {
    positionsM: concatFloat32(positionParts),
    normals: concatFloat32(normalParts),
    indices: Uint32Array.from(indexValues),
    faces: allFaces,
    triangleFaceIndices: Uint32Array.from(triangleFaceIndices),
    edgePointsM: concatFloat32(edgePointParts),
    edgePointRanges: Uint32Array.from(edgePointRanges),
    edges: allEdges,
    polylineEdgeIndices: Uint32Array.from(polylineEdgeIndices),
  };
}
