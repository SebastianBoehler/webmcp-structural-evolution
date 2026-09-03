import * as THREE from "three";
import { expect, it } from "vitest";

import { addSemanticScene } from "./semantic-three-scene";
import { updateRetainedSemanticReplay } from "./semantic-three-replay";
import type { SemanticRenderState } from "./webgpu-renderer-types";

function state(document: SemanticRenderState["document"], scale: number, scalarScale = 1): SemanticRenderState {
  const grid = { dimensions: [2, 1, 1] as const, cellSize: [1, 1, 1] as const,
    origin: [0, 0, 0] as const, active: new Uint8Array([1, 0]) };
  return { document, revision: document.revision, measurements: [], resultLayers: {
    topology: { ...grid, density: new Float32Array([1, 0]) },
    stress: { ...grid, values: new Float32Array([10, 0]), maximum: 10, scalarScale },
    displacement: { ...grid, values: new Float32Array([1, 2]), maximum: 2,
      vectors: new Float32Array([.1, 0, 0, .2, 0, 0]), displacementUnit: "mm",
      deformationScale: scale },
    mechanism: { componentId: "assembly:design",
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  } };
}

it("deforms and recolors retained topology surface vertices with replay fields", () => {
  const document = { revision: "retained", frame: { lengthUnit: "mm" as const,
    angleUnit: "radian" as const }, nodes: [
    { id: "assembly:design", kind: "assembly" as const },
    { id: "component:motor", kind: "component" as const, parentId: "assembly:design",
      transform: { position: [.25, .5, .5] as const, rotation: [0, 0, 0] as const } },
  ] };
  const scene = new THREE.Scene(), initial = state(document, 0, 0);
  addSemanticScene(THREE, scene, initial, false);
  const field = scene.getObjectByName("verified-topology-surface") as THREE.Mesh;
  const geometry = field.geometry, material = field.material;
  const beforePositions = Array.from(field.geometry.getAttribute("position").array);
  const beforeColors = Array.from(field.geometry.getAttribute("color").array);

  expect(updateRetainedSemanticReplay(THREE, scene, initial, state(document, 10, 1))).toBe(true);
  expect(scene.getObjectByName("verified-topology-surface")).toBe(field);
  expect(field.geometry).toBe(geometry);
  expect(field.material).toBe(material);
  expect(Array.from(field.geometry.getAttribute("position").array)).not.toEqual(beforePositions);
  expect(Array.from(field.geometry.getAttribute("color").array)).not.toEqual(beforeColors);
  expect(field.userData.deformationScale).toBe(10);
  expect(scene.getObjectByName("semantic:component:motor")!.position.x).toBeCloseTo(1.25);
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
