export const CAD_RESOURCE_LIMITS = Object.freeze({
  bodyDynamicsBodies: 256,
  bodyDynamicsBrepBytes: 128 * 1024 * 1024,
  // Original terminal payload + private capture + one consumer copy stay at or below 288 MiB.
  mechanismExactSourceBytes: 96 * 1024 * 1024,
  semanticMeshVertices: 2_000_000,
  semanticMeshTriangles: 4_000_000,
  semanticMeshEdgePoints: 2_000_000,
  semanticMeshTopologyRecords: 500_000,
  semanticMeshTopologyAdjacencyEntries: 4_000_000,
  semanticMeshTopologyStringBytes: 16 * 1024 * 1024,
  semanticMeshBytes: 128 * 1024 * 1024,
  canonicalDigestBytes: 128 * 1024 * 1024,
  canonicalDigestNodes: 1_000_000,
});

export interface SemanticMeshUsage {
  readonly vertices: number;
  readonly triangles: number;
  readonly edgePoints: number;
  readonly topologyRecords: number;
  readonly bytes: number;
}

export class CadResourceLimitError extends Error {
  readonly code = "resource-limit" as const;

  constructor(resource: string, actual: number, limit: number) {
    super(`CAD ${resource} resource limit exceeded: ${actual} > ${limit}`);
    this.name = "CadResourceLimitError";
  }
}

export function assertCadResourceLimit(
  resource: string,
  actual: number,
  limit: number,
): void {
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > limit) {
    throw new CadResourceLimitError(resource, actual, limit);
  }
}

export function assertSemanticMeshUsage(usage: SemanticMeshUsage): void {
  assertCadResourceLimit("semantic mesh vertices", usage.vertices, CAD_RESOURCE_LIMITS.semanticMeshVertices);
  assertCadResourceLimit("semantic mesh triangles", usage.triangles, CAD_RESOURCE_LIMITS.semanticMeshTriangles);
  assertCadResourceLimit("semantic mesh edge points", usage.edgePoints, CAD_RESOURCE_LIMITS.semanticMeshEdgePoints);
  assertCadResourceLimit("semantic topology records", usage.topologyRecords, CAD_RESOURCE_LIMITS.semanticMeshTopologyRecords);
  assertCadResourceLimit("semantic mesh bytes", usage.bytes, CAD_RESOURCE_LIMITS.semanticMeshBytes);
}
