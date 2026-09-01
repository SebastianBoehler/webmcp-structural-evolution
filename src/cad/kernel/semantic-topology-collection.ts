import type { OcctKernel, ShapeHandle } from "occt-wasm";

import { assertCadResourceLimit, CAD_RESOURCE_LIMITS } from "../cad-resource-limits";
import type { TopologySignature } from "./persistent-references";

const HASH_UPPER_BOUND = 2_147_483_647;

export interface HashedSignature {
  readonly hash: number;
  readonly signature: TopologySignature;
  readonly surfaceEvidence?: SurfaceEvidence;
}

export type SurfaceEvidence =
  | { readonly kind: "plane"; readonly normal: [number, number, number] }
  | { readonly kind: "cylinder"; readonly axis: [number, number, number];
    readonly originM: [number, number, number]; readonly radiusM: number };

export interface CollectedTopology {
  readonly faces: readonly HashedSignature[];
  readonly edges: readonly HashedSignature[];
}

const geometryForSurface = (value: string): TopologySignature["geometry"] =>
  value === "plane" || value === "cylinder" || value === "cone" || value === "sphere"
    ? value
    : "other";
const canonicalZero = (value: number) => Object.is(value, -0) ? 0 : value;

function unit(vector: readonly number[]): [number, number, number] {
  const scale = Math.max(...vector.map(Math.abs));
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error("Exact face direction is invalid");
  const scaled = vector.map((value) => value / scale);
  const magnitude = Math.hypot(...scaled);
  return scaled.map((value) => canonicalZero(value / magnitude)) as [number, number, number];
}

function canonicalAxis(vector: readonly number[]): [number, number, number] {
  const normalized = unit(vector);
  const pivot = normalized.reduce((best, value, index, values) =>
    Math.abs(value) > Math.abs(values[best]!) ? index : best, 0);
  return (normalized[pivot]! < 0 ? normalized.map((value) => -value) : normalized)
    .map(canonicalZero) as [number, number, number];
}

function surfaceEvidence(kernel: OcctKernel, face: ShapeHandle, geometry: string): SurfaceEvidence | undefined {
  if (geometry !== "plane" && geometry !== "cylinder") return undefined;
  const center = kernel.getSurfaceCenterOfMass(face);
  const uv = kernel.uvFromPoint(face, center);
  if (geometry === "plane") {
    const normal = kernel.surfaceNormal(face, uv.u, uv.v);
    return { kind: "plane", normal: unit([normal.x, normal.y, normal.z]) };
  }
  const cylinder = kernel.getFaceCylinderData(face);
  if (!cylinder || !(cylinder.radius > 0)) throw new Error("Exact cylindrical face omitted cylinder evidence");
  const bounds = kernel.uvBounds(face), u = (bounds.uMin + bounds.uMax) / 2;
  const first = kernel.pointOnSurface(face, u, bounds.vMin);
  const last = kernel.pointOnSurface(face, u, bounds.vMax);
  const axis = canonicalAxis([last.x - first.x, last.y - first.y, last.z - first.z]);
  const point = kernel.pointOnSurface(face, uv.u, uv.v);
  const opposite = kernel.pointOnSurface(face, uv.u + Math.PI, uv.v);
  const axisPoint = [(point.x + opposite.x) / 2,
    (point.y + opposite.y) / 2, (point.z + opposite.z) / 2];
  const centerOffset = [center.x - axisPoint[0], center.y - axisPoint[1], center.z - axisPoint[2]];
  const along = centerOffset[0]! * axis[0] + centerOffset[1]! * axis[1] + centerOffset[2]! * axis[2];
  const originM = axisPoint.map((value, index) => canonicalZero(value + along * axis[index]!)) as [number, number, number];
  return { kind: "cylinder", axis, originM, radiusM: cylinder.radius };
}

function edgeFaces(kernel: OcctKernel, shape: ShapeHandle): Map<number, number[]> {
  const flat = kernel.edgeToFaceMap(shape, HASH_UPPER_BOUND);
  assertCadResourceLimit(
    "topology adjacency entries", flat.length,
    CAD_RESOURCE_LIMITS.semanticMeshTopologyRecords * 8,
  );
  const result = new Map<number, number[]>();
  for (let index = 0; index < flat.length;) {
    const edgeHash = flat[index++]!;
    const count = flat[index++]!;
    assertCadResourceLimit(
      "edge-face adjacency", count, CAD_RESOURCE_LIMITS.semanticMeshTopologyRecords,
    );
    if (index + count > flat.length) throw new Error("OCCT edge-to-face map is truncated");
    const hashes = new Set(result.get(edgeHash) ?? []);
    for (let end = index + count; index < end; index += 1) hashes.add(flat[index]!);
    result.set(edgeHash, Array.from(hashes));
  }
  return result;
}

export function collectTopology(
  kernel: OcctKernel,
  shape: ShapeHandle,
  ownerFeatureId: string,
): CollectedTopology {
  const faces = kernel.getSubShapes(shape, "face");
  const edges = kernel.getSubShapes(shape, "edge");
  assertCadResourceLimit(
    "topology records", faces.length + edges.length,
    CAD_RESOURCE_LIMITS.semanticMeshTopologyRecords,
  );
  const faceKinds = new Map<number, string>();
  for (const face of faces) {
    faceKinds.set(kernel.hashCode(face, HASH_UPPER_BOUND), kernel.surfaceType(face));
  }
  const faceSignatures = faces.map((face): HashedSignature => {
    const center = kernel.getSurfaceCenterOfMass(face);
    const geometry = geometryForSurface(kernel.surfaceType(face));
    const adjacentKinds = kernel.adjacentFaces(shape, face)
      .map((adjacent) => kernel.surfaceType(adjacent)).sort();
    return {
      hash: kernel.hashCode(face, HASH_UPPER_BOUND),
      signature: {
        ownerFeatureId, kind: "face", geometry,
        centroidM: [center.x, center.y, center.z], measureSI: kernel.getSurfaceArea(face),
        adjacentKinds,
      }, surfaceEvidence: surfaceEvidence(kernel, face, geometry),
    };
  });
  const adjacency = edgeFaces(kernel, shape);
  const edgeSignatures = edges.map((edge): HashedSignature => {
    const hash = kernel.hashCode(edge, HASH_UPPER_BOUND);
    const center = kernel.getLinearCenterOfMass(edge);
    return {
      hash,
      signature: {
        ownerFeatureId, kind: "edge", geometry: "curve",
        centroidM: [center.x, center.y, center.z], measureSI: kernel.curveLength(edge),
        adjacentKinds: (adjacency.get(hash) ?? [])
          .map((faceHash) => faceKinds.get(faceHash) ?? "other").sort(),
      },
    };
  });
  return { faces: faceSignatures, edges: edgeSignatures };
}
