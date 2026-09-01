import type * as THREE from "three";

import type { TransformAxis, TransformSpace } from "./webgpu-transform-drag";

export interface MovableSemanticOwner {
  readonly semanticId: string;
  readonly object: THREE.Object3D;
}

export interface WebGpuTransformGizmo {
  readonly root: THREE.Group;
  readonly owner: MovableSemanticOwner;
  axisFor(object: THREE.Object3D | undefined): TransformAxis | undefined;
  setSpace(space: TransformSpace): void;
  sync(): void;
  dispose(): void;
}

const axes: readonly Readonly<{
  axis: TransformAxis;
  direction: readonly [number, number, number];
  color: number;
}>[] = [
  { axis: "x", direction: [1, 0, 0], color: 0xf05252 },
  { axis: "y", direction: [0, 1, 0], color: 0x4ac26b },
  { axis: "z", direction: [0, 0, 1], color: 0x4d82e8 },
];

function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const owned = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    owned.filter(Boolean).forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function createWebGpuTransformGizmo(
  three: typeof THREE,
  scene: THREE.Scene,
  owner: MovableSemanticOwner,
  initialSpace: TransformSpace,
  size: number,
): WebGpuTransformGizmo {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError("transform gizmo size must be positive and finite");
  }
  const root = new three.Group();
  root.name = "semantic-transform-gizmo";
  root.userData.semanticGizmo = true;
  let space = initialSpace;
  let disposed = false;

  for (const { axis, direction, color } of axes) {
    const handle = new three.Group();
    handle.name = `semantic-transform-handle:${axis}`;
    handle.userData.transformAxis = axis;
    const material = new three.MeshBasicMaterial({ color, depthTest: false });
    const shaft = new three.Mesh(
      new three.CylinderGeometry(size * .025, size * .025, size * .7, 10),
      material,
    );
    const head = new three.Mesh(
      new three.ConeGeometry(size * .07, size * .22, 12),
      material,
    );
    shaft.position.y = size * .35;
    head.position.y = size * .81;
    const target = new three.Vector3(...direction);
    handle.quaternion.setFromUnitVectors(new three.Vector3(0, 1, 0), target);
    handle.add(shaft, head);
    handle.traverse((object) => {
      object.userData.transformAxis = axis;
      object.renderOrder = 1000;
    });
    root.add(handle);
  }

  const sync = () => {
    owner.object.updateWorldMatrix(true, false);
    owner.object.getWorldPosition(root.position);
    if (space === "local") owner.object.getWorldQuaternion(root.quaternion);
    else root.quaternion.identity();
    root.updateMatrixWorld(true);
  };
  scene.add(root);
  sync();

  return {
    root,
    owner,
    axisFor(object) {
      for (let current = object; current && current !== root.parent; current = current.parent ?? undefined) {
        const axis = current.userData.transformAxis;
        if (axis === "x" || axis === "y" || axis === "z") return axis;
        if (current === root) break;
      }
      return undefined;
    },
    setSpace(next) { space = next; sync(); },
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      disposeTree(root);
    },
  };
}
