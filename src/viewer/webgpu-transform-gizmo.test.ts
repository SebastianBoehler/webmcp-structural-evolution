import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { createWebGpuTransformGizmo } from "./webgpu-transform-gizmo";

describe("WebGPU semantic transform gizmo", () => {
  it("creates visible raycastable XYZ shaft and head handles and owns their disposal", () => {
    const scene = new THREE.Scene();
    const component = new THREE.Group();
    component.userData.semanticId = "component:arm";
    component.userData.movable = true;
    component.rotation.z = Math.PI / 2;
    scene.add(component);
    scene.updateMatrixWorld(true);

    const gizmo = createWebGpuTransformGizmo(THREE, scene, {
      semanticId: "component:arm", object: component,
    }, "local", 2);
    const handles = ["x", "y", "z"].map((axis) =>
      scene.getObjectByName(`semantic-transform-handle:${axis}`)!);
    expect(handles.every(Boolean)).toBe(true);
    expect(gizmo.axisFor(handles[0]!.children[0]!)).toBe("x");
    expect(gizmo.root.quaternion.angleTo(component.quaternion)).toBeCloseTo(0);

    const disposals: ReturnType<typeof vi.spyOn>[] = [];
    gizmo.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) disposals.push(vi.spyOn(mesh.geometry, "dispose"));
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (material) disposals.push(vi.spyOn(material, "dispose"));
    });
    gizmo.dispose();
    gizmo.dispose();
    expect(gizmo.root.parent).toBeNull();
    expect(disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });
});
