import * as THREE from "three";
import { expect, it } from "vitest";

import { addSemanticScene } from "./semantic-three-scene";
import { updateRetainedSemanticReplay } from "./semantic-three-replay";
import type { SemanticRenderState } from "./webgpu-renderer-types";

function state(document: SemanticRenderState["document"], scale: number, scalarScale = 1): SemanticRenderState {
  const grid = { dimensions: [2, 1, 1] as const, cellSize: [1, 1, 1] as const,
    origin: [0, 0, 0] as const, active: new Uint8Array([1, 1]) };
  return { document, revision: document.revision, measurements: [], resultLayers: {
    topology: { ...grid, density: new Float32Array([1, 1]) },
    stress: { ...grid, values: new Float32Array([0, 10]), maximum: 10, scalarScale },
    displacement: { ...grid, values: new Float32Array([1, 2]), maximum: 2,
      vectors: new Float32Array([.1, 0, 0, .2, 0, 0]), displacementUnit: "mm",
      deformationScale: scale },
    mechanism: { componentId: "assembly:design",
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  } };
}

it("updates replay matrices, colors, and mounted roots without replacing retained objects", () => {
  const document = { revision: "retained", frame: { lengthUnit: "mm" as const,
    angleUnit: "radian" as const }, nodes: [
    { id: "assembly:design", kind: "assembly" as const },
    { id: "component:motor", kind: "component" as const, parentId: "assembly:design",
      transform: { position: [.25, .5, .5] as const, rotation: [0, 0, 0] as const } },
  ] };
  const scene = new THREE.Scene(), initial = state(document, 0, 0);
  addSemanticScene(THREE, scene, initial, false);
  const field = scene.getObjectByName("semantic-result-field") as THREE.InstancedMesh;
  const geometry = field.geometry, material = field.material;
  const beforeColor = new THREE.Color();
  field.getColorAt(1, beforeColor);

  expect(updateRetainedSemanticReplay(THREE, scene, initial, state(document, 10, 1))).toBe(true);
  expect(scene.getObjectByName("semantic-result-field")).toBe(field);
  expect(field.geometry).toBe(geometry);
  expect(field.material).toBe(material);
  const matrix = new THREE.Matrix4();
  field.getMatrixAt(1, matrix);
  expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBeCloseTo(3.5);
  expect(scene.getObjectByName("semantic:component:motor")!.position.x).toBeCloseTo(1.25);
  const afterColor = new THREE.Color();
  field.getColorAt(1, afterColor);
  expect(afterColor.getHex()).not.toBe(beforeColor.getHex());
});

it("restores baseline transforms and rejects a changed semantic document", () => {
  const document = { revision: "retained", frame: { lengthUnit: "mm" as const,
    angleUnit: "radian" as const }, nodes: [
    { id: "assembly:design", kind: "assembly" as const },
    { id: "component:motor", kind: "component" as const, parentId: "assembly:design",
      transform: { position: [.25, .5, .5] as const, rotation: [0, 0, 0] as const } },
  ] };
  const scene = new THREE.Scene(), initial = state(document, 10);
  addSemanticScene(THREE, scene, initial, false);
  const paused = { ...state(document, 0), resultLayers: {
    ...state(document, 0).resultLayers, mechanism: undefined,
  } } as SemanticRenderState;

  expect(updateRetainedSemanticReplay(THREE, scene, initial, paused)).toBe(true);
  expect(scene.getObjectByName("semantic:component:motor")!.position.x).toBeCloseTo(.25);
  expect(updateRetainedSemanticReplay(THREE, scene, paused,
    state({ ...document, nodes: [...document.nodes] }, 1))).toBe(false);
});

it("retains topology-only load replay frames", () => {
  const document = { revision: "loads", frame: { lengthUnit: "mm" as const,
    angleUnit: "radian" as const }, nodes: [
    { id: "assembly:design", kind: "assembly" as const },
  ] };
  const initial = state(document, 0);
  const topologyOnly = { ...initial, resultLayers: {
    topology: initial.resultLayers.topology,
    mechanism: initial.resultLayers.mechanism,
  } } as SemanticRenderState;
  const scene = new THREE.Scene();
  addSemanticScene(THREE, scene, topologyOnly, false);

  expect(updateRetainedSemanticReplay(THREE, scene, topologyOnly, topologyOnly)).toBe(true);
});
