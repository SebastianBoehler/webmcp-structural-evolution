import { describe, expect, it } from "vitest";
import type { SemanticMeshPayload } from "../cad/rebuild-payload";
import { semanticArtifactFromSemanticMesh, semanticArtifactFromViewerModel, validateSemanticDocument } from "./semantic-scene";

describe("semantic scene artifacts", () => {
  it("keeps exact face and edge topology IDs with owned geometry", () => {
    const artifact = semanticArtifactFromSemanticMesh({
      positionsM: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]), triangleFaceIndices: new Uint32Array([0]),
      faces: [{ id: "face:exact", bodyId: "body:exact", signature: { ownerFeatureId: "feature:exact", kind: "face", geometry: "plane", centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [] }, surfaceEvidence: { kind: "plane", normal: [0, 0, 1] } }],
      edgePointsM: new Float32Array([0, 0, 0, 1, 0, 0]), edgePointRanges: new Uint32Array([0, 2]), polylineEdgeIndices: new Uint32Array([0]),
      edges: [{ id: "edge:exact", bodyId: "body:exact", signature: { ownerFeatureId: "feature:exact", kind: "edge", geometry: "curve", centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [] } }],
    }, "r1");
    const face = artifact.nodes.find((node) => node.sourceTopology?.id === "face:exact");
    const edge = artifact.nodes.find((node) => node.sourceTopology?.id === "edge:exact");
    expect(face?.geometry?.positions).toEqual(new Float32Array([0, 0, 0, 1_000, 0, 0, 0, 1_000, 0]));
    expect(edge?.geometry?.polylines).toEqual([new Float32Array([0, 0, 0, 1_000, 0, 0])]);
  });

  it("threads the exact CAD semantic mesh into the active viewer artifact without inventing surface indices", () => {
    const semanticMesh = {
      positionsM: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]), triangleFaceIndices: new Uint32Array([0]),
      faces: [{ id: "face:authoritative", bodyId: "body:authoritative", signature: { ownerFeatureId: "feature:authoritative", kind: "face", geometry: "plane", centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [] }, surfaceEvidence: { kind: "plane", normal: [0, 0, 1] } }],
      edgePointsM: new Float32Array([0, 0, 0, 1, 0, 0]), edgePointRanges: new Uint32Array([0, 2]), polylineEdgeIndices: new Uint32Array([0]),
      edges: [{ id: "edge:authoritative", bodyId: "body:authoritative", signature: { ownerFeatureId: "feature:authoritative", kind: "edge", geometry: "curve", centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [] } }],
    } as unknown as SemanticMeshPayload;
    const artifact = semanticArtifactFromViewerModel({ grid: { dimensions: { width: 1, height: 1, depth: 1 }, cellSize: [1, 1, 1], anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] } }, currentInstances: new Uint32Array(), alternativeLayers: [], assemblyParts: [{ id: "exact", selectionId: "exact", label: "Exact", appearance: "generated", kind: "mesh", center: [0, 0, 0], mesh: { surfaces: [], sizeMm: [1, 1, 1], triangleCount: 1, semanticMesh } }] }, "exact-rev");
    expect(artifact.nodes.filter((node) => node.sourceTopology?.id === "face:authoritative")).toHaveLength(1);
    expect(artifact.nodes.filter((node) => node.kind === "face")).toHaveLength(1);
  });

  it("does not turn sparse topology occupancy into an opaque full-domain face", () => {
    const artifact = semanticArtifactFromViewerModel({ grid: { dimensions: { width: 3, height: 1, depth: 1 }, cellSize: [2, 2, 2], anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] } }, currentInstances: new Uint32Array([1]), alternativeLayers: [] }, "topology");
    expect(artifact.nodes.find((node) => node.id === "face:topology-field")?.geometry).toBeUndefined();
  });

  it("fails closed on duplicate IDs, missing parents, cycles, invalid nesting, and unknown selection", () => {
    const frame = { lengthUnit: "mm", angleUnit: "radian" } as const;
    expect(() => validateSemanticDocument({ revision: "r", frame, nodes: [{ id: "a", kind: "face" }] })).toThrow("invalid semantic parent");
    expect(() => validateSemanticDocument({ revision: "r", frame, nodes: [{ id: "a", kind: "assembly" }, { id: "a", kind: "component", parentId: "a" }] })).toThrow("duplicate");
    expect(() => validateSemanticDocument({ revision: "r", frame, nodes: [{ id: "a", kind: "assembly", parentId: "b" }, { id: "b", kind: "component", parentId: "a" }] })).toThrow("missing parent");
    expect(() => validateSemanticDocument({ revision: "r", frame, nodes: [
      { id: "a", kind: "assembly" },
      { id: "component:a", kind: "component", parentId: "a", sourceSelectionId: "shared" },
      { id: "component:b", kind: "component", parentId: "a", sourceSelectionId: "shared" },
    ] })).toThrow(/source selection/i);
    expect(() => validateSemanticDocument({ revision: "r", frame, nodes: [
      { id: "a", kind: "assembly" },
      { id: "component:a", kind: "component", parentId: "a" },
      { id: "body:a", kind: "body", parentId: "component:a", sourceSelectionId: "foreign" },
    ] } as never)).toThrow(/source selection/i);
  });
});
