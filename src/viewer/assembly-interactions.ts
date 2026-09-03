import * as THREE from "three";

import { selectableAssemblyMeshes, type AssemblyMeshSet } from "./assembly-meshes";

export interface PartInteractionHandlers {
  readonly onSelect?: (partId: string) => void;
  readonly onMove?: (partId: string, center: readonly [number, number, number]) => unknown;
  readonly onDragState?: (dragging: boolean, partId: string) => void;
}

interface InteractionControls {
  enabled?: boolean;
}

interface InteractionOptions {
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.PerspectiveCamera;
  readonly meshSet: AssemblyMeshSet;
  readonly controls: InteractionControls;
  readonly handlers: PartInteractionHandlers;
  readonly scheduleRender: () => void;
  readonly own: (release: () => void) => void;
}

export function installAssemblyInteractions({
  canvas,
  camera,
  meshSet,
  controls,
  handlers,
  scheduleRender,
  own,
}: InteractionOptions): void {
  if ((!handlers.onSelect && !handlers.onMove) || meshSet.meshes.length === 0) return;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let press: readonly [number, number] | undefined;
  let drag: {
    readonly partId: string;
    readonly dragGroup: string;
    readonly plane: THREE.Plane;
    readonly offset: THREE.Vector3;
  } | undefined;
  const setPointer = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    return true;
  };
  const pointerDown = (event: PointerEvent) => {
    if (drag) return;
    press = [event.clientX, event.clientY];
    if (!handlers.onMove || !setPointer(event)) return;
    const hit = raycaster.intersectObjects([...selectableAssemblyMeshes(meshSet.meshes)], false)[0];
    if (!hit?.object.userData.movable) return;
    const partId = hit.object.userData.partId;
    const part = [...meshSet.parts.values()].find((candidate) => candidate.selectionId === partId);
    if (!part || typeof partId !== "string") return;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -part.center[2]);
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, point)) return;
    drag = {
      partId,
      dragGroup: part.dragGroup ?? part.id,
      plane,
      offset: new THREE.Vector3(...part.center).sub(point),
    };
    if (controls.enabled !== undefined) controls.enabled = false;
    canvas.setPointerCapture?.(event.pointerId);
    handlers.onSelect?.(partId);
    handlers.onDragState?.(true, partId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag || !setPointer(event)) return;
    const activeDrag = drag;
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(activeDrag.plane, point)) return;
    point.add(activeDrag.offset);
    const source = [...meshSet.parts.values()].find((part) => part.selectionId === activeDrag.partId);
    if (!source) return;
    const delta = point.clone().sub(new THREE.Vector3(...source.center));
    for (const [id, root] of meshSet.roots) {
      const part = meshSet.parts.get(id);
      if (part?.dragGroup === activeDrag.dragGroup) {
        root.position.set(part.center[0] + delta.x, part.center[1] + delta.y, part.center[2]);
      }
    }
    scheduleRender();
  };
  const pointerUp = (event: PointerEvent | MouseEvent) => {
    if (drag) {
      const activeDrag = drag;
      const root = [...meshSet.roots.entries()].find(([id]) =>
        meshSet.parts.get(id)?.selectionId === activeDrag.partId)?.[1];
      if (root) handlers.onMove?.(activeDrag.partId, [root.position.x, root.position.y, root.position.z]);
      handlers.onDragState?.(false, activeDrag.partId);
      drag = undefined;
      if (controls.enabled !== undefined) controls.enabled = true;
      if ("pointerId" in event) canvas.releasePointerCapture?.(event.pointerId);
      press = undefined;
      return;
    }
    if (!press || Math.hypot(event.clientX - press[0], event.clientY - press[1]) > 5) return;
    press = undefined;
    if (!setPointer(event)) return;
    const hit = raycaster.intersectObjects([...selectableAssemblyMeshes(meshSet.meshes)], false)[0];
    const partId = hit?.object.userData.partId;
    if (typeof partId === "string") handlers.onSelect?.(partId);
  };
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", pointerUp);
  window.addEventListener("mouseup", pointerUp);
  own(() => window.removeEventListener("mouseup", pointerUp));
  own(() => window.removeEventListener("pointercancel", pointerUp));
  own(() => window.removeEventListener("pointerup", pointerUp));
  own(() => canvas.removeEventListener("pointerup", pointerUp));
  own(() => canvas.removeEventListener("pointermove", pointerMove));
  own(() => canvas.removeEventListener("pointerdown", pointerDown));
}
