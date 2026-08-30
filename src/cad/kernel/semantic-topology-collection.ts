import type { OcctKernel, ShapeHandle } from "occt-wasm";

import { assertCadResourceLimit, CAD_RESOURCE_LIMITS } from "../cad-resource-limits";
import type { TopologySignature } from "./persistent-references";

const HASH_UPPER_BOUND = 2_147_483_647;

export interface HashedSignature {
  readonly hash: number;
  readonly signature: TopologySignature;
}

export interface CollectedTopology {
  readonly faces: readonly HashedSignature[];
  readonly edges: readonly HashedSignature[];
}

const geometryForSurface = (value: string): TopologySignature["geometry"] =>
  value === "plane" || value === "cylinder" || value === "cone" || value === "sphere"
    ? value
    : "other";

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
    const adjacentKinds = kernel.adjacentFaces(shape, face)
      .map((adjacent) => kernel.surfaceType(adjacent)).sort();
    return {
      hash: kernel.hashCode(face, HASH_UPPER_BOUND),
      signature: {
        ownerFeatureId, kind: "face", geometry: geometryForSurface(kernel.surfaceType(face)),
        centroidM: [center.x, center.y, center.z], measureSI: kernel.getSurfaceArea(face),
        adjacentKinds,
      },
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
