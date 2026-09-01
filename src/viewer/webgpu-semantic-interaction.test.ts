import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSelectedSemanticGizmo,
  createWebGpuSemanticInteraction,
  nearestMovableSemanticOwner,
} from "./webgpu-semantic-interaction";
import { createWebGpuTransformGizmo } from "./webgpu-transform-gizmo";

function pointer(type: string, x: number, y: number, pointerId = 7) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

function fixture() {
  const scene = new THREE.Scene();
  const component = new THREE.Group();
  component.userData.semanticId = "component:arm";
  component.userData.movable = true;
  const face = new THREE.Group();
  face.userData.semanticId = "face:arm:front";
  face.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), new THREE.MeshBasicMaterial()));
  component.add(face);
  scene.add(component);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", { value: () => ({
    left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200,
    x: 0, y: 0, toJSON: () => ({}),
  }) });
  document.body.append(canvas);
  return { scene, component, face, camera, canvas };
}

beforeEach(() => { document.body.replaceChildren(); });

describe("WebGPU semantic pointer interaction", () => {
  it("selects the exact raycast leaf without starting component movement", () => {
    const value = fixture();
    const nonSemantic = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial(),
    );
    nonSemantic.position.z = .2;
    value.scene.add(nonSemantic);
    value.scene.updateMatrixWorld(true);
    const onSelect = vi.fn(), begin = vi.fn(() => true);
    const interaction = createWebGpuSemanticInteraction(THREE, {
      ...value, raycaster: new THREE.Raycaster(), handlers: () => ({ onSelect }),
      gizmo: () => undefined,
      transform: { begin, move: vi.fn(), end: vi.fn() },
    });

    value.canvas.dispatchEvent(pointer("pointerdown", 100, 100));
    expect(onSelect).toHaveBeenCalledWith("face:arm:front");
    expect(begin).not.toHaveBeenCalled();
    expect(nearestMovableSemanticOwner(value.face)).toEqual({
      semanticId: "component:arm", object: value.component,
    });

    value.canvas.dispatchEvent(pointer("pointerdown", 199, 1));
    expect(onSelect).toHaveBeenCalledTimes(1);
    interaction.dispose();
    value.canvas.dispatchEvent(pointer("pointerdown", 100, 100));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("selects an exact edge leaf and never promotes it to its component", () => {
    const value = fixture();
    value.scene.remove(value.component);
    const component = new THREE.Group();
    component.userData.semanticId = "component:wire";
    component.userData.movable = true;
    const edge = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-.5, 0, 0), new THREE.Vector3(.5, 0, 0),
      ]),
      new THREE.LineBasicMaterial(),
    );
    edge.userData.semanticId = "edge:wire:axis";
    component.add(edge);
    value.scene.add(component);
    value.scene.updateMatrixWorld(true);
    const onSelect = vi.fn();
    const interaction = createWebGpuSemanticInteraction(THREE, {
      ...value, raycaster: new THREE.Raycaster(), handlers: () => ({ onSelect }),
      gizmo: () => undefined,
      transform: { begin: vi.fn(() => true), move: vi.fn(), end: vi.fn() },
    });

    value.canvas.dispatchEvent(pointer("pointerdown", 100, 100));
    expect(onSelect).toHaveBeenCalledWith("edge:wire:axis");
    interaction.dispose();
  });

  it("starts axis-constrained movement only from a real gizmo handle", () => {
    const value = fixture();
    const gizmo = createWebGpuTransformGizmo(THREE, value.scene, {
      semanticId: "component:arm", object: value.component,
    }, "world", 2);
    const begin = vi.fn(() => true), end = vi.fn();
    const interaction = createWebGpuSemanticInteraction(THREE, {
      ...value, raycaster: new THREE.Raycaster(), handlers: () => ({}),
      gizmo: () => gizmo, transform: { begin, move: vi.fn(), end },
    });
    const projected = new THREE.Vector3(.55, 0, 0).project(value.camera);
    value.canvas.dispatchEvent(pointer("pointerdown", (projected.x + 1) * 100, (1 - projected.y) * 100));
    expect(begin).toHaveBeenCalledWith(
      "component:arm", value.component, "x", expect.any(THREE.Ray),
    );
    window.dispatchEvent(pointer("pointerup", 100, 100));
    expect(end).toHaveBeenCalledOnce();
    interaction.dispose();
    gizmo.dispose();
  });

  it("creates XYZ handles for a movable leaf owner but not a nonmovable edge", () => {
    const value = fixture();
    const gizmo = createSelectedSemanticGizmo(
      THREE, value.scene, value.face, "world", 2,
    );
    expect(gizmo?.owner.semanticId).toBe("component:arm");
    expect(["x", "y", "z"].every((axis) =>
      value.scene.getObjectByName(`semantic-transform-handle:${axis}`))).toBe(true);
    gizmo?.dispose();

    value.component.userData.movable = false;
    const edge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    edge.userData.semanticId = "edge:arm:rim";
    value.component.add(edge);
    expect(createSelectedSemanticGizmo(THREE, value.scene, edge, "world", 2)).toBeUndefined();
  });
});
