import * as THREE from "three";
import { expect, it } from "vitest";

import {
  addSemanticScene,
  configureSemanticReferenceGrid,
  semanticSceneBounds,
} from "./semantic-three-scene";
import { renderEnvelope } from "./webgpu-renderer-helpers";
import type { SemanticRenderState } from "./webgpu-renderer-types";

const state: SemanticRenderState = {
  revision: "0.42m-part",
  selection: undefined,
  resultLayers: {},
  sectionPlane: { normal: [0, 0, 1], constant: 0 },
  measurements: [{ from: [0, 0, 0], to: [100, 100, 100] }],
  document: { revision: "0.42m-part", frame: { lengthUnit: "mm", angleUnit: "radian" }, nodes: [
    { id: "assembly:test", kind: "assembly" },
    { id: "component:test", kind: "component", parentId: "assembly:test" },
    { id: "body:test", kind: "body", parentId: "component:test" },
    { id: "feature:test", kind: "feature", parentId: "body:test" },
    { id: "face:test", kind: "face", parentId: "feature:test", geometry: {
      positions: new Float32Array([0, 0, 0, .42, 0, 0, 0, .01, 0]),
      indices: new Uint32Array([0, 1, 2]),
    } },
  ] },
};

it("fits semantic content only and derives a z-up XY grid from its 0.42m envelope", () => {
  const scene = new THREE.Scene();
  addSemanticScene(THREE, scene, state, true);

  const bounds = semanticSceneBounds(THREE, scene);
  const envelope = renderEnvelope(bounds.min.toArray(), bounds.max.toArray());
  configureSemanticReferenceGrid(scene, bounds, envelope);
  const grid = scene.getObjectByName("semantic-reference-grid") as THREE.GridHelper;

  expect(bounds.max.x - bounds.min.x).toBeCloseTo(.42, 6);
  expect(envelope.span).toBeCloseTo(Math.hypot(.42, .01), 6);
  expect(grid.rotation.x).toBeCloseTo(Math.PI / 2);
  expect(grid.position.toArray()).toEqual([
    expect.closeTo(.21, 6), expect.closeTo(.005, 6), 0,
  ]);
  expect(grid.scale.x).toBeCloseTo(envelope.span * 1.4);
  expect(grid.scale.z).toBeCloseTo(envelope.span * 1.4);
  expect(new THREE.Box3().setFromObject(grid).max.x).toBeGreaterThan(bounds.max.x);
});

it("renders the production semantic topology as a smooth density surface in the replayed assembly frame", () => {
  const scene = new THREE.Scene();
  addSemanticScene(THREE, scene, {
    ...state,
    resultLayers: {
      topology: {
        dimensions: [2, 1, 1], cellSize: [0.1, 0.1, 0.1], origin: [0.2, 0, 0],
        active: new Uint8Array([1, 0]), density: new Float32Array([1, 0]),
      },
      mechanism: {
        componentId: "assembly:test",
        transform: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    },
  }, false);

  const assembly = scene.getObjectByName("semantic:assembly:test")!;
  const topology = scene.getObjectByName("verified-topology-surface") as THREE.Mesh;
  expect(scene.getObjectByName("semantic-result-field")).toBeUndefined();
  expect(topology.userData.surfaceTreatment).toMatch(/density-derived signed-distance/i);
  expect(topology.parent).toBe(assembly);
  expect(topology.getWorldQuaternion(new THREE.Quaternion()).angleTo(
    assembly.getWorldQuaternion(new THREE.Quaternion()),
  )).toBeCloseTo(0, 6);
});

it("deforms topology cells and translates mounted components from the same signed field", () => {
  const scene = new THREE.Scene();
  addSemanticScene(THREE, scene, {
    ...state,
    resultLayers: { displacement: {
      dimensions: [1, 1, 1], cellSize: [1, 1, 1], origin: [0, 0, 0],
      active: new Uint8Array([1]), values: new Float32Array([.1]), maximum: .1,
      vectors: new Float32Array([.1, -.2, .3]), displacementUnit: "mm",
      sourceDisplacementUnit: "m", deformationScale: 10,
    } },
  }, false);

  scene.getObjectByName("semantic:component:test")!.position.toArray().forEach((value, axis) => {
    expect(value).toBeCloseTo([1, -2, 3][axis]!, 6);
  });
  const topology = scene.getObjectByProperty("isInstancedMesh", true) as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  topology.getMatrixAt(0, matrix);
  new THREE.Vector3().setFromMatrixPosition(matrix).toArray().forEach((value, axis) => {
    expect(value).toBeCloseTo([1.5, -1.5, 3.5][axis]!, 6);
  });
});

it("highlights all component descendants but only the exact selected leaf", () => {
  const document = { ...state.document, nodes: [
    ...state.document.nodes,
    { id: "face:second", kind: "face" as const, parentId: "feature:test", geometry: {
      positions: new Float32Array([0, 0, 0, 0, .01, 0, 0, 0, .01]),
      indices: new Uint32Array([0, 1, 2]),
    } },
  ] };
  const colors = (selection: string) => {
    const scene = new THREE.Scene();
    addSemanticScene(THREE, scene, { ...state, document, selection }, false);
    return ["face:test", "face:second"].map((id) => {
      const group = scene.getObjectByName(`semantic:${id}`)!;
      return (group.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh<
        THREE.BufferGeometry, THREE.MeshStandardMaterial
      >).material.color.getHex();
    });
  };

  expect(colors("component:test")).toEqual([0x5ad3ff, 0x5ad3ff]);
  expect(colors("face:test")).toEqual([0x5ad3ff, 0x5c94d4]);
});
