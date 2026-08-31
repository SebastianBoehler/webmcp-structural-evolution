import type { OcctKernel, ShapeHandle } from "occt-wasm";

import {
  assertCadResourceLimit,
  assertSemanticMeshUsage,
  CAD_RESOURCE_LIMITS,
  type SemanticMeshUsage,
} from "../cad-resource-limits";
import type { DesignDocument } from "../document-schema";
import {
  assertSemanticMeshPayloadLimits,
  type SemanticMeshPayload,
  type SemanticTopology,
} from "../rebuild-payload";
import {
  matchTopologyReference,
  topologyGeometryKey,
  type TopologySignature,
} from "./persistent-references";
import { CadRebuildError } from "./rebuild-errors";
import { repairConsumersForTopology, type SelectionDocument } from "./named-selection-resolution";
import {
  collectTopology,
  type CollectedTopology,
  type HashedSignature,
} from "./semantic-topology-collection";
import {
  concatFloat32,
  concatOffsetUint32,
  concatUint32,
  containsUint32,
  type OffsetUint32Part,
} from "./typed-array-assembly";

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

function assignOwner(
  signature: TopologySignature,
  body: RebuiltBodyShape,
  featureTopology: ReadonlyMap<string, CollectedTopology>,
  document: SelectionDocument,
): string {
  for (const featureId of body.lineageFeatureIds) {
    const candidates = signature.kind === "face"
      ? featureTopology.get(featureId)?.faces
      : featureTopology.get(featureId)?.edges;
    if (!candidates) continue;
    const match = matchTopologyReference(
      { ...signature, ownerFeatureId: featureId },
      candidates.map((candidate, index) => ({
        id: `${featureId}:${signature.kind}:${candidate.hash}:${index}`,
        signature: candidate.signature,
      })),
    );
    if (match.ok) return featureId;
    if (match.error.candidateIds.length > 0) {
      throw new CadRebuildError(
        "reference-requires-repair",
        match.error.message,
        repairConsumersForTopology(document, body.id, signature.kind, [featureId]),
      );
    }
  }
  throw new CadRebuildError(
    "reference-requires-repair",
    `Topology owner matched no feature lineage candidate: ${topologyGeometryKey(signature)}`,
    repairConsumersForTopology(document, body.id, signature.kind, body.lineageFeatureIds),
  );
}

function semanticRecords(
  topology: readonly HashedSignature[],
  body: RebuiltBodyShape,
  featureTopology: ReadonlyMap<string, CollectedTopology>,
  document: SelectionDocument,
): { readonly records: SemanticTopology[]; readonly indexByHash: ReadonlyMap<number, number> } {
  const owned = topology.map(({ hash, signature }) => ({
    hash,
    signature: {
      ...signature,
      ownerFeatureId: assignOwner(signature, body, featureTopology, document),
      centroidM: [...signature.centroidM] as [number, number, number],
      adjacentKinds: [...signature.adjacentKinds],
    },
  }));
  const semanticIds = new Set<string>();
  const records = owned.map(({ signature }) => {
    const id = `${signature.kind}:${body.id}:${signature.ownerFeatureId}:${topologyGeometryKey(signature)}`;
    if (semanticIds.has(id)) {
      throw new CadRebuildError(
        "reference-requires-repair",
        `Semantic topology ID is ambiguous: ${id}`,
        repairConsumersForTopology(document, body.id, signature.kind, [signature.ownerFeatureId]),
      );
    }
    semanticIds.add(id);
    return { id, bodyId: body.id, signature };
  });
  const indexByHash = new Map<number, number>();
  owned.forEach(({ hash }, index) => {
    if (indexByHash.has(hash)) throw new Error(`OCCT topology hash collision in body: ${body.id}`);
    indexByHash.set(hash, index);
  });
  return { records, indexByHash };
}

function appendItems<Value>(target: Value[], values: readonly Value[]): void {
  const start = target.length;
  target.length += values.length;
  for (let index = 0; index < values.length; index += 1) {
    target[start + index] = values[index]!;
  }
}

export function tessellateSemanticBodies(
  kernel: OcctKernel,
  features: readonly RebuiltFeatureShape[],
  bodies: readonly RebuiltBodyShape[],
  document: Pick<DesignDocument, "namedSelections" | "mates">,
): SemanticMeshPayload {
  const featureTopology = new Map<string, CollectedTopology>();
  let featureTopologyRecords = 0;
  for (const feature of features) {
    const topology = collectTopology(kernel, feature.shape, feature.id);
    featureTopologyRecords += topology.faces.length + topology.edges.length;
    assertCadResourceLimit(
      "feature topology records", featureTopologyRecords,
      CAD_RESOURCE_LIMITS.semanticMeshTopologyRecords,
    );
    featureTopology.set(feature.id, topology);
  }
  const positionParts: Float32Array[] = [];
  const normalParts: Float32Array[] = [];
  const indexParts: OffsetUint32Part[] = [];
  const triangleFaceParts: Uint32Array[] = [];
  const edgePointParts: Float32Array[] = [];
  const edgeRangeParts: Uint32Array[] = [];
  const polylineEdgeParts: Uint32Array[] = [];
  const allFaces: SemanticTopology[] = [];
  const allEdges: SemanticTopology[] = [];
  let vertexOffset = 0;
  let edgePointOffset = 0;
  let positionLength = 0;
  let normalLength = 0;
  let indexLength = 0;
  let triangleOwnerLength = 0;
  let edgePointLength = 0;
  let edgeRangeLength = 0;
  let polylineEdgeLength = 0;
  let usage: SemanticMeshUsage = {
    vertices: 0, triangles: 0, edgePoints: 0, topologyRecords: 0, bytes: 0,
  };

  for (const body of bodies) {
    const topology = collectTopology(kernel, body.shape, body.terminalFeatureId);
    const faces = semanticRecords(topology.faces, body, featureTopology, document);
    const edges = semanticRecords(topology.edges, body, featureTopology, document);
    const mesh = kernel.meshShape(body.shape, {
      linearDeflection: SEMANTIC_LINEAR_DEFLECTION_M,
      angularDeflection: SEMANTIC_ANGULAR_DEFLECTION_RAD,
      relative: false,
    });
    if (!mesh.faceGroups || mesh.faceGroups.length % 3 !== 0) {
      throw new Error(`OCCT tessellation omitted valid face groups: ${body.id}`);
    }
    const wireframe = kernel.wireframe(body.shape, SEMANTIC_LINEAR_DEFLECTION_M);
    if (wireframe.edgeGroups.length % 3 !== 0 || wireframe.points.length % 3 !== 0) {
      throw new Error(`OCCT tessellation returned invalid edge buffers: ${body.id}`);
    }
    const edgeGroupCount = wireframe.edgeGroups.length / 3;
    const nextUsage = {
      vertices: usage.vertices + mesh.vertexCount,
      triangles: usage.triangles + mesh.triangleCount,
      edgePoints: usage.edgePoints + wireframe.points.length / 3,
      topologyRecords: usage.topologyRecords + faces.records.length + edges.records.length,
      bytes: usage.bytes + mesh.positions.byteLength + mesh.normals.byteLength
        + mesh.indices.byteLength + mesh.triangleCount * Uint32Array.BYTES_PER_ELEMENT
        + wireframe.points.byteLength + edgeGroupCount * 3 * Uint32Array.BYTES_PER_ELEMENT,
    } satisfies SemanticMeshUsage;
    assertSemanticMeshUsage(nextUsage);
    usage = nextUsage;
    if (mesh.positions.length !== mesh.vertexCount * 3
      || mesh.normals.length !== mesh.positions.length
      || mesh.indices.length !== mesh.triangleCount * 3
      || containsUint32(mesh.indices, (index) => index >= mesh.vertexCount)) {
      throw new Error(`OCCT tessellation returned inconsistent mesh buffers: ${body.id}`);
    }
    const faceOffset = allFaces.length;
    const edgeOffset = allEdges.length;
    appendItems(allFaces, faces.records);
    appendItems(allEdges, edges.records);
    positionParts.push(mesh.positions);
    normalParts.push(mesh.normals);
    indexParts.push({ values: mesh.indices, offset: vertexOffset });
    const localOwners = new Uint32Array(mesh.triangleCount);
    localOwners.fill(0xffff_ffff);
    for (let index = 0; index < mesh.faceGroups.length; index += 3) {
      const rawStart = mesh.faceGroups[index]!;
      const rawCount = mesh.faceGroups[index + 1]!;
      if (rawStart % 3 !== 0 || rawCount % 3 !== 0
        || rawStart + rawCount > mesh.indices.length) {
        throw new Error(`OCCT tessellation returned an invalid face range: ${body.id}`);
      }
      const start = rawStart / 3;
      const count = rawCount / 3;
      const owner = faces.indexByHash.get(mesh.faceGroups[index + 2]!);
      if (owner === undefined) throw new Error(`Tessellated face has no semantic owner: ${body.id}`);
      localOwners.fill(faceOffset + owner, start, start + count);
    }
    if (containsUint32(localOwners, (owner) => owner === 0xffff_ffff)) {
      throw new Error(`Triangle has no semantic owner: ${body.id}`);
    }
    triangleFaceParts.push(localOwners);
    positionLength += mesh.positions.length;
    normalLength += mesh.normals.length;
    indexLength += mesh.indices.length;
    triangleOwnerLength += localOwners.length;
    vertexOffset += mesh.vertexCount;

    edgePointParts.push(wireframe.points);
    const localRanges = new Uint32Array(edgeGroupCount * 2);
    const localEdges = new Uint32Array(edgeGroupCount);
    for (let index = 0; index < wireframe.edgeGroups.length; index += 3) {
      const rawStart = wireframe.edgeGroups[index]!;
      const rawCount = wireframe.edgeGroups[index + 1]!;
      if (rawStart % 3 !== 0 || rawCount % 3 !== 0
        || rawStart + rawCount > wireframe.points.length) {
        throw new Error(`OCCT tessellation returned an invalid edge range: ${body.id}`);
      }
      const owner = edges.indexByHash.get(wireframe.edgeGroups[index + 2]!);
      if (owner === undefined) throw new Error(`Tessellated edge has no semantic owner: ${body.id}`);
      const group = index / 3;
      localRanges[group * 2] = edgePointOffset + rawStart / 3;
      localRanges[group * 2 + 1] = rawCount / 3;
      localEdges[group] = edgeOffset + owner;
    }
    edgeRangeParts.push(localRanges);
    polylineEdgeParts.push(localEdges);
    edgePointLength += wireframe.points.length;
    edgeRangeLength += localRanges.length;
    polylineEdgeLength += localEdges.length;
    edgePointOffset += wireframe.points.length / 3;
  }

  const payload = {
    positionsM: concatFloat32(positionParts, positionLength),
    normals: concatFloat32(normalParts, normalLength),
    indices: concatOffsetUint32(indexParts, indexLength),
    faces: allFaces,
    triangleFaceIndices: concatUint32(triangleFaceParts, triangleOwnerLength),
    edgePointsM: concatFloat32(edgePointParts, edgePointLength),
    edgePointRanges: concatUint32(edgeRangeParts, edgeRangeLength),
    edges: allEdges,
    polylineEdgeIndices: concatUint32(polylineEdgeParts, polylineEdgeLength),
  };
  assertSemanticMeshPayloadLimits(payload);
  return payload;
}
