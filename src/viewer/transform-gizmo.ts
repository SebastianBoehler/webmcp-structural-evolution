import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import type { AssemblyMeshSet } from "./assembly-meshes";
import type { PartInteractionHandlers } from "./assembly-interactions";

interface OrbitToggle { enabled?: boolean }

export interface TransformGizmoSession {
  setSelectedPart(partId: string | undefined): void;
  setSpace(space: "world" | "local"): void;
  setSnap(distance: number | null): void;
}

export function installTransformGizmo(options: {
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.PerspectiveCamera;
  readonly meshSet: AssemblyMeshSet;
  readonly controls: OrbitToggle;
  readonly handlers: PartInteractionHandlers;
  readonly attach: (object: THREE.Object3D) => void;
  readonly scheduleRender: () => void;
  readonly own: (release: () => void) => void;
}): TransformGizmoSession {
  const transform = new TransformControls(options.camera, options.canvas);
  transform.setMode("translate");
  transform.setSize(0.82);
  transform.setSpace("world");
  transform.setTranslationSnap(10);
  const helper = transform.getHelper();
  helper.name = "cad-transform-gizmo";
  options.attach(helper);
  options.own(() => transform.dispose());
  let selectedPart: string | undefined;
  let sourceRoot: THREE.Group | undefined;
  let sourceStart = new THREE.Vector3();
  let groupStarts = new Map<string, THREE.Vector3>();

  const partRoot = (selectionId: string) => [...options.meshSet.roots.entries()].find(
    ([id]) => options.meshSet.parts.get(id)?.selectionId === selectionId,
  );
  const begin = () => {
    if (!selectedPart) return;
    const entry = partRoot(selectedPart);
    if (!entry) return;
    sourceRoot = entry[1];
    sourceStart = sourceRoot.position.clone();
    const dragGroup = options.meshSet.parts.get(entry[0])?.dragGroup;
    groupStarts = new Map([...options.meshSet.roots.entries()]
      .filter(([id]) => dragGroup && options.meshSet.parts.get(id)?.dragGroup === dragGroup)
      .map(([id, root]) => [id, root.position.clone()]));
  };
  const updateGroup = () => {
    if (!sourceRoot) return;
    const delta = sourceRoot.position.clone().sub(sourceStart);
    for (const [id, start] of groupStarts) {
      const root = options.meshSet.roots.get(id);
      if (root && root !== sourceRoot) root.position.copy(start).add(delta);
    }
    options.scheduleRender();
  };
  const finish = () => {
    if (selectedPart && sourceRoot) {
      options.handlers.onMove?.(selectedPart, [sourceRoot.position.x, sourceRoot.position.y, sourceRoot.position.z]);
      options.handlers.onDragState?.(false, selectedPart);
    }
    sourceRoot = undefined;
    groupStarts.clear();
  };
  transform.addEventListener("mouseDown", () => {
    begin();
    if (options.controls.enabled !== undefined) options.controls.enabled = false;
    if (selectedPart) options.handlers.onDragState?.(true, selectedPart);
  });
  transform.addEventListener("objectChange", updateGroup);
  transform.addEventListener("mouseUp", () => {
    if (options.controls.enabled !== undefined) options.controls.enabled = true;
    finish();
  });

  return {
    setSelectedPart(partId) {
      selectedPart = partId;
      const entry = partId ? partRoot(partId) : undefined;
      const part = entry && options.meshSet.parts.get(entry[0]);
      if (entry && part?.movable) transform.attach(entry[1]);
      else transform.detach();
      options.scheduleRender();
    },
    setSpace: (space) => { transform.setSpace(space); options.scheduleRender(); },
    setSnap: (distance) => transform.setTranslationSnap(distance),
  };
}
