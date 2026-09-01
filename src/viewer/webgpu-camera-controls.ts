import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  fitPerspectiveCameraToBounds,
  perspectiveBoundsInsideSafeFrustum,
} from "./webgpu-camera-fit";
import type { SemanticView } from "./webgpu-renderer-types";

type OrbitControlsConstructor = new (
  camera: THREE.Camera,
  canvas: HTMLElement,
) => OrbitControls;

export interface WebGpuCameraControls {
  frame(
    bounds: THREE.Box3,
    target: readonly [number, number, number],
    aspect: number,
  ): void;
  refit(bounds: THREE.Box3, target: readonly [number, number, number], aspect: number): void;
  setView(view: SemanticView): void;
  focus(): void;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

function viewOffset(view: SemanticView): readonly [number, number, number] {
  if (view === "top") return [0, 0, 1.6];
  if (view === "front") return [0, -1.6, 0];
  if (view === "right") return [1.6, 0, 0];
  return [1, -1, .8];
}

export function createWebGpuCameraControls(
  Controls: OrbitControlsConstructor,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  scheduleRender: () => void,
): WebGpuCameraControls {
  const controls = new Controls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  let view: SemanticView = "isometric";
  let fitRequested = true;
  let applyingFrame = false;
  let disposed = false;

  const onChange = () => {
    if (!applyingFrame && !disposed) scheduleRender();
  };
  controls.addEventListener("change", onChange);

  const fit = (bounds: THREE.Box3, target: readonly [number, number, number], aspect: number,
    direction: THREE.Vector3) => {
    applyingFrame = true;
    const center = new THREE.Vector3(...target);
    fitPerspectiveCameraToBounds(THREE, camera, bounds, center, direction, aspect);
    controls.target.set(...target);
    controls.update();
    applyingFrame = false;
  };

  return {
    frame(bounds, target, aspect) {
      if (disposed) return;
      if (!fitRequested) {
        const aspectMatches = Math.abs(camera.aspect - aspect) <= Number.EPSILON * 8;
        if (aspectMatches && perspectiveBoundsInsideSafeFrustum(THREE, camera, bounds)) return;
        const direction = camera.position.clone().sub(controls.target).normalize();
        fit(bounds, target, aspect, direction);
        return;
      }
      const offset = viewOffset(view);
      camera.up.set(0, view === "top" ? 1 : 0, view === "top" ? 0 : 1);
      fit(bounds, target, aspect, new THREE.Vector3(...offset).normalize());
      fitRequested = false;
    },
    refit(bounds, target, aspect) {
      if (disposed) return;
      const direction = camera.position.clone().sub(controls.target).normalize();
      fit(bounds, target, aspect, direction);
    },
    setView(next) {
      view = next;
      fitRequested = true;
    },
    focus() {
      fitRequested = true;
    },
    isEnabled: () => controls.enabled,
    setEnabled(enabled) { controls.enabled = enabled; },
    dispose() {
      if (disposed) return;
      disposed = true;
      controls.removeEventListener("change", onChange);
      controls.dispose();
    },
  };
}
