import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { SemanticMeshPayload } from "../cad/rebuild-payload";
import type { AssemblyVisualPart, ViewerRenderModel } from "./render-model-types";
import { semanticArtifactFromViewerModel } from "./semantic-scene";
import { addSemanticScene } from "./semantic-three-scene";

function exactMesh(twoRanges = false): SemanticMeshPayload {
  return {
    positionsM: new Float32Array([0, 0, 0, .001, 0, 0, 0, .002, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    triangleFaceIndices: new Uint32Array([0]),
    faces: [{ id: "face:source/verbatim", bodyId: "body:source", signature: {
      ownerFeatureId: "feature:source", kind: "face", geometry: "plane",
      centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [],
    }, surfaceEvidence: { kind: "plane", normal: [0, 0, 1] } }],
    edgePointsM: twoRanges
      ? new Float32Array([0, 0, 0, .001, 0, 0, 0, .001, 0, .002, .001, 0])
      : new Float32Array([0, 0, 0, .002, 0, 0]),
    edgePointRanges: twoRanges ? new Uint32Array([0, 2, 2, 2]) : new Uint32Array([0, 2]),
    polylineEdgeIndices: twoRanges ? new Uint32Array([0, 0]) : new Uint32Array([0]),
    edges: [{ id: "edge:source/verbatim", bodyId: "body:source", signature: {
      ownerFeatureId: "feature:source", kind: "edge", geometry: "curve",
      centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [],
    } }],
  };
}

function part(id: string, selectionId: string, mesh = exactMesh()): AssemblyVisualPart {
  return { id, selectionId, label: id, center: [0, 0, 0], appearance: "generated",
    kind: "mesh", mesh: { surfaces: [], sizeMm: [2, 2, 1], triangleCount: 1,
      semanticMesh: mesh } };
}

function model(parts: readonly AssemblyVisualPart[]): ViewerRenderModel {
  return { grid: { dimensions: { width: 1, height: 1, depth: 1 }, cellSize: [1, 1, 1],
    anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] } },
  currentInstances: new Uint32Array(), alternativeLayers: [], assemblyParts: parts };
}

describe("semantic adapter frame and occurrence authority", () => {
  it("converts exact SI coordinates once and preserves source topology provenance", () => {
    const source = exactMesh();
    const artifact = semanticArtifactFromViewerModel(model([part("part", "occurrence", source)]), "r1");
    const face = artifact.nodes.find((node) => node.kind === "face")!;
    const edge = artifact.nodes.find((node) => node.kind === "edge")!;

    expect(artifact.frame).toEqual({ lengthUnit: "mm", angleUnit: "radian" });
    expect(face.geometry?.positions).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]));
    expect(edge.geometry?.polylines).toEqual([new Float32Array([0, 0, 0, 2, 0, 0])]);
    expect(face.sourceTopology).toEqual({ id: "face:source/verbatim", bodyId: "body:source",
      ownerFeatureId: "feature:source" });
    expect(edge.sourceTopology?.id).toBe("edge:source/verbatim");
    expect(face.ownerComponentId).toBe("component:occurrence");
    expect(source.positionsM[3]).toBeCloseTo(.001);
  });

  it("scopes identical exact topology independently for two occurrences", () => {
    const shared = exactMesh();
    const artifact = semanticArtifactFromViewerModel(model([
      part("shared-body", "left", shared), part("shared-body", "right", shared),
    ]), "twice");
    const faces = artifact.nodes.filter((node) => node.kind === "face");

    expect(artifact.nodes.filter((node) => node.kind === "component").map(({ id }) => id))
      .toEqual(["component:left", "component:right"]);
    expect(new Set(faces.map(({ id }) => id)).size).toBe(2);
    expect(faces.map(({ sourceTopology }) => sourceTopology?.id))
      .toEqual(["face:source/verbatim", "face:source/verbatim"]);
    expect(faces.map(({ ownerComponentId }) => ownerComponentId))
      .toEqual(["component:left", "component:right"]);
  });

  it("groups visual parts sharing a selection under one component without invented topology", () => {
    const visual = (id: string, x: number): AssemblyVisualPart => ({ id, selectionId: "motor", label: id,
      center: [x, 0, 0], appearance: "component", kind: "cylinder", radius: 1, height: 2 });
    const artifact = semanticArtifactFromViewerModel(model([visual("housing", 10), visual("shaft", 12)]), "visual");
    const descendants = artifact.nodes.filter(({ parentId }) => parentId === "component:motor"
      || parentId?.includes(":motor:"));

    expect(artifact.nodes.filter(({ id }) => id === "component:motor")).toHaveLength(1);
    expect(artifact.nodes.find(({ id }) => id === "component:motor")?.sourceSelectionId).toBe("motor");
    expect(new Set(descendants.map(({ id }) => id)).size).toBe(descendants.length);
    expect(artifact.nodes.filter(({ kind }) => kind === "face" || kind === "edge")).toHaveLength(0);
    expect(artifact.nodes.filter(({ kind, geometry }) => kind === "feature" && geometry)).toHaveLength(2);
    expect(artifact.nodes.find(({ id }) => id === "component:motor")?.transform?.position)
      .toEqual([10, 0, 0]);
    expect(artifact.nodes.find(({ id }) => id === "body:motor:shaft")?.transform?.position)
      .toEqual([2, 0, 0]);
  });

  it("preserves every polyline range for one exact edge and keeps visual outlines nonsemantic", () => {
    const visual: AssemblyVisualPart = { id: "pin", selectionId: "pin", label: "Pin",
      center: [0, 0, 0], appearance: "component", kind: "cylinder", radius: 1, height: 2 };
    const artifact = semanticArtifactFromViewerModel(model([
      part("wire", "wire", exactMesh(true)), visual,
    ]), "ranges");
    const edge = artifact.nodes.find(({ kind }) => kind === "edge")!;
    expect(edge.geometry?.polylines).toEqual([
      new Float32Array([0, 0, 0, 1, 0, 0]),
      new Float32Array([0, 1, 0, 2, 1, 0]),
    ]);
    expect(artifact.nodes.filter(({ kind }) => kind === "edge")).toHaveLength(1);

    const scene = new THREE.Scene();
    addSemanticScene(THREE, scene, { revision: "ranges", document: artifact,
      resultLayers: {}, measurements: [] }, false);
    const edgeGroup = scene.getObjectByName(`semantic:${edge.id}`)!;
    expect(edgeGroup.children.filter((child) => child instanceof THREE.Line)).toHaveLength(2);
    const visualGroup = artifact.nodes.find(({ kind, geometry }) => kind === "feature" && geometry)!;
    const outline = scene.getObjectByName(`semantic:${visualGroup.id}`)!.children
      .find((child) => child instanceof THREE.LineSegments)!;
    expect(outline.userData.semanticId).toBeUndefined();
  });
});
