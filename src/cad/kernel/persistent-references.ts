export interface TopologySignature {
  readonly ownerFeatureId: string;
  readonly kind: "face" | "edge";
  readonly geometry: "plane" | "cylinder" | "cone" | "sphere" | "curve" | "other";
  readonly centroidM: readonly [number, number, number];
  readonly measureSI: number;
  readonly adjacentKinds: readonly string[];
}

export interface TopologyCandidate {
  readonly id: string;
  readonly signature: TopologySignature;
}

export interface TopologyMatchTolerance {
  readonly centroidM: number;
  readonly edgeMeasureM: number;
  readonly faceMeasureM2: number;
}

export const DEFAULT_TOPOLOGY_TOLERANCE: TopologyMatchTolerance = {
  centroidM: 1e-9,
  edgeMeasureM: 1e-9,
  faceMeasureM2: 1e-12,
};

export type TopologyMatch =
  | { readonly ok: true; readonly candidate: TopologyCandidate }
  | {
    readonly ok: false;
    readonly error: {
      readonly code: "reference-requires-repair";
      readonly message: string;
      readonly candidateIds: readonly string[];
    };
  };

const quantize = (value: number, tolerance: number) => Math.round(value / tolerance);
const sameText = (left: readonly string[], right: readonly string[]) => {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
};

function sameQuantizedGeometry(
  reference: TopologySignature,
  candidate: TopologySignature,
  tolerance: TopologyMatchTolerance,
): boolean {
  const measureTolerance = reference.kind === "face"
    ? tolerance.faceMeasureM2
    : tolerance.edgeMeasureM;
  return reference.centroidM.every((value, index) =>
    quantize(value, tolerance.centroidM) === quantize(candidate.centroidM[index]!, tolerance.centroidM))
    && quantize(reference.measureSI, measureTolerance)
      === quantize(candidate.measureSI, measureTolerance);
}

export function topologyGeometryKey(
  signature: TopologySignature,
  tolerance: TopologyMatchTolerance = DEFAULT_TOPOLOGY_TOLERANCE,
): string {
  const measureTolerance = signature.kind === "face"
    ? tolerance.faceMeasureM2
    : tolerance.edgeMeasureM;
  return [
    signature.kind,
    signature.geometry,
    ...signature.centroidM.map((value) => quantize(value, tolerance.centroidM)),
    quantize(signature.measureSI, measureTolerance),
    [...signature.adjacentKinds].sort().join("+"),
  ].join(":");
}

export function sameTopologyGeometry(
  left: TopologySignature,
  right: TopologySignature,
  tolerance: TopologyMatchTolerance = DEFAULT_TOPOLOGY_TOLERANCE,
): boolean {
  return left.kind === right.kind
    && left.geometry === right.geometry
    && sameQuantizedGeometry(left, right, tolerance)
    && sameText(left.adjacentKinds, right.adjacentKinds);
}

export function matchTopologyReference(
  reference: TopologySignature,
  candidates: readonly TopologyCandidate[],
  tolerance: TopologyMatchTolerance = DEFAULT_TOPOLOGY_TOLERANCE,
): TopologyMatch {
  const lineage = candidates.filter(({ signature }) =>
    signature.ownerFeatureId === reference.ownerFeatureId && signature.kind === reference.kind);
  const geometry = lineage.filter(({ signature }) => signature.geometry === reference.geometry);
  const quantified = geometry.filter(({ signature }) =>
    sameQuantizedGeometry(reference, signature, tolerance));
  const adjacent = quantified.filter(({ signature }) =>
    sameText(reference.adjacentKinds, signature.adjacentKinds));
  if (adjacent.length === 1) return { ok: true, candidate: adjacent[0]! };

  const candidateIds = adjacent.map(({ id }) => id).sort();
  return {
    ok: false,
    error: {
      code: "reference-requires-repair",
      message: candidateIds.length === 0
        ? "Topology reference matched no candidates"
        : `Topology reference matched multiple candidates: ${candidateIds.join(", ")}`,
      candidateIds,
    },
  };
}
