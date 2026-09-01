import type * as THREE from "three";

import type { SemanticInteractionHandlers } from "./webgpu-renderer-types";
import type { TransformAxis } from "./webgpu-transform-drag";
import { createWebGpuTransformGizmo,
  type MovableSemanticOwner, type WebGpuTransformGizmo } from "./webgpu-transform-gizmo";

interface PointerTransform {
  begin(
    semanticId: string,
    object: THREE.Object3D,
    axis: TransformAxis,
    ray: THREE.Ray,
  ): boolean;
  move(ray: THREE.Ray): void;
  end(): void;
}

interface SemanticInteractionOptions {
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly raycaster: THREE.Raycaster;
  readonly transform: PointerTransform;
  readonly gizmo: () => WebGpuTransformGizmo | undefined;
  readonly handlers: () => SemanticInteractionHandlers;
}

export interface WebGpuSemanticInteraction {
  dispose(): void;
}

function belongsToGizmo(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current.userData.semanticGizmo === true) return true;
  }
  return false;
}

export function exactSemanticLeaf(object: THREE.Object3D | undefined): string | undefined {
  for (let current = object; current; current = current.parent ?? undefined) {
    if (typeof current.userData.semanticId === "string") {
      return current.userData.semanticId as string;
    }
  }
  return undefined;
}

export function nearestMovableSemanticOwner(
  object: THREE.Object3D | undefined,
): MovableSemanticOwner | undefined {
  for (let current = object; current; current = current.parent ?? undefined) {
    const semanticId = current.userData.semanticId;
    if (current.userData.movable === true
      && typeof semanticId === "string"
      && semanticId.startsWith("component:")) {
      return { semanticId, object: current };
    }
  }
  return undefined;
}

export function createSelectedSemanticGizmo(
  three: typeof THREE,
  scene: THREE.Scene,
  selected: THREE.Object3D | undefined,
  space: "world" | "local",
  size: number,
): WebGpuTransformGizmo | undefined {
  const owner = nearestMovableSemanticOwner(selected);
  return owner ? createWebGpuTransformGizmo(three, scene, owner, space, size) : undefined;
}

export function createWebGpuSemanticInteraction(
  three: typeof THREE,
  options: SemanticInteractionOptions,
): WebGpuSemanticInteraction {
  const { canvas, scene, camera, raycaster, transform } = options;
  let activePointer: number | undefined;
  let disposed = false;

  const setPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    raycaster.setFromCamera(new three.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1,
    ), camera);
    return true;
  };
  const pointerDown = (event: PointerEvent) => {
    if (disposed || !setPointer(event)) return;
    const intersections = raycaster.intersectObjects(scene.children, true);
    const gizmo = options.gizmo();
    if (gizmo) {
      const axisHit = intersections.find(({ object }) => gizmo.axisFor(object));
      const axis = gizmo.axisFor(axisHit?.object);
      if (axis) {
        if (!transform.begin(gizmo.owner.semanticId, gizmo.owner.object, axis, raycaster.ray)) return;
        activePointer = event.pointerId;
        canvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    const semanticId = intersections
      .filter(({ object }) => !belongsToGizmo(object))
      .map(({ object }) => exactSemanticLeaf(object))
      .find((value) => value !== undefined);
    if (semanticId) options.handlers().onSelect?.(semanticId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (activePointer === undefined || event.pointerId !== activePointer || !setPointer(event)) return;
    transform.move(raycaster.ray);
  };
  const pointerUp = (event: PointerEvent) => {
    if (activePointer === undefined || (event.pointerId !== undefined
      && event.pointerId !== activePointer)) return;
    transform.end();
    canvas.releasePointerCapture?.(activePointer);
    activePointer = undefined;
    event.preventDefault();
  };
  canvas.addEventListener("pointerdown", pointerDown, true);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", pointerUp);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (activePointer !== undefined) transform.end();
      activePointer = undefined;
      canvas.removeEventListener("pointerdown", pointerDown, true);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
    },
  };
}
