import * as THREE from "three";
import { expect, it, vi } from "vitest";

import { addSemanticScene } from "./semantic-three-scene";
import type { SemanticRenderState } from "./webgpu-renderer-types";

it("renders signed heat flux as owned visible shaft and head geometry", () => {
  const scene = new THREE.Scene();
  const state: SemanticRenderState = {
    revision: "flux", selection: undefined, measurements: [],
    document: { revision: "flux", frame: { lengthUnit: "mm", angleUnit: "radian" },
      nodes: [{ id: "assembly:test", kind: "assembly" }] },
    resultLayers: { flux: { dimensions: [1, 1, 1], cellSize: [10, 10, 10],
      origin: [0, 0, 0], active: new Uint8Array([1]), values: new Float32Array([5]),
      maximum: 5, vectors: new Float32Array([-1, 2, -3]), vectorUnit: "W/m^2" } },
  };
  const release = addSemanticScene(THREE, scene, state, false);
  const arrow = scene.getObjectByName("semantic-flux-arrow") as THREE.Group;
  const shaft = arrow.getObjectByName("semantic-flux-arrow-shaft") as THREE.Mesh;
  const head = arrow.getObjectByName("semantic-flux-arrow-head") as THREE.Mesh;
  expect(shaft).toBeInstanceOf(THREE.Mesh);
  expect(head).toBeInstanceOf(THREE.Mesh);
  const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion).normalize();
  expect(direction.toArray()).toEqual([
    expect.closeTo(-1 / Math.sqrt(14)), expect.closeTo(2 / Math.sqrt(14)),
    expect.closeTo(-3 / Math.sqrt(14)),
  ]);
  const resources = [shaft, head].flatMap((mesh) => [mesh.geometry,
    mesh.material as THREE.Material]);
  const disposals = resources.map((resource) => vi.spyOn(resource, "dispose"));
  release();
  release();
  expect(scene.getObjectByName("semantic-flux-arrow")).toBeUndefined();
  expect(disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
});
