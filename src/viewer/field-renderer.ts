import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { AlternativeLayer } from "./alternative-instances";
import {
  createFieldMeshes,
  disposeFieldMeshes,
  highlightFieldMesh,
  type FieldMeshSet,
} from "./field-meshes";
import type { InstanceRecord, VoxelGrid } from "./field-instances";

// A 2x DPR ceiling is a rendering-budget decision: voxel comparisons favor legibility over 3x pixels.
export const MAX_RENDER_DPR = 2;

export interface ResizeEntryLike {
  readonly devicePixelContentBoxSize?: readonly {
    readonly inlineSize: number;
    readonly blockSize: number;
  }[];
  readonly contentRect: { readonly width: number; readonly height: number };
}

interface RendererLike {
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

interface ControlsLike {
  enableDamping: boolean;
  readonly target: { set(x: number, y: number, z: number): unknown };
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
  update(): void;
  dispose(): void;
}

interface ObserverLike {
  observe(target: Element, options?: ResizeObserverOptions): void;
  disconnect(): void;
}

export interface FieldViewerEnvironment {
  readonly createRenderer: (canvas: HTMLCanvasElement) => RendererLike;
  readonly createControls: (camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) => ControlsLike;
  readonly createResizeObserver: (
    callback: (entries: readonly ResizeEntryLike[]) => void,
  ) => ObserverLike;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly devicePixelRatio: () => number;
  readonly prefersReducedMotion: () => boolean;
}

export interface ViewerRenderModel {
  readonly grid: VoxelGrid;
  readonly currentInstances: readonly InstanceRecord[];
  readonly alternativeLayers: readonly AlternativeLayer[];
}

export interface FieldRendererSession {
  dispose(): void;
  setHighlightedBranch(branchRevision: string | undefined): void;
}

const defaultEnvironment: FieldViewerEnvironment = {
  createRenderer: (canvas) => new THREE.WebGLRenderer({ antialias: true, canvas }),
  createControls: (camera, canvas) => new OrbitControls(camera, canvas),
  createResizeObserver: (callback) => new ResizeObserver((entries) => callback(entries)),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  devicePixelRatio: () => window.devicePixelRatio || 1,
  prefersReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

export function viewerEnvironment(
  override: FieldViewerEnvironment | undefined,
): FieldViewerEnvironment {
  return override ?? defaultEnvironment;
}

function cameraFor(grid: VoxelGrid): THREE.PerspectiveCamera {
  const size = grid.dimensions;
  const span = Math.max(
    size.width * grid.cellSize[0],
    size.height * grid.cellSize[1],
    size.depth * grid.cellSize[2],
  );
  const camera = new THREE.PerspectiveCamera(
    38,
    1,
    Math.max(0.01, span / 1000),
    Math.max(1, span * 20),
  );
  camera.position.set(
    grid.anchor.position[0] + span * 1.4,
    grid.anchor.position[1] + span,
    grid.anchor.position[2] + span * 1.8,
  );
  camera.lookAt(...grid.anchor.position);
  return camera;
}

export function mountFieldRenderer(
  canvas: HTMLCanvasElement,
  model: ViewerRenderModel,
  environment: FieldViewerEnvironment,
): FieldRendererSession {
  let renderer: RendererLike | undefined;
  let controls: ControlsLike | undefined;
  let observer: ObserverLike | undefined;
  let meshSet: FieldMeshSet | undefined;
  let controlsListening = false;
  let frame: number | undefined;
  let disposed = false;
  const scene = new THREE.Scene();
  const camera = cameraFor(model.grid);
  let width = 1;
  let height = 1;
  const render = () => {
    frame = undefined;
    if (disposed || !renderer) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const scheduleRender = () => {
    if (!disposed && frame === undefined) frame = environment.requestFrame(render);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (frame !== undefined) environment.cancelFrame(frame);
    frame = undefined;
    try { observer?.disconnect(); } catch { /* Continue releasing owned resources. */ }
    if (controlsListening) {
      try { controls?.removeEventListener("change", scheduleRender); } catch { /* Continue. */ }
    }
    try { controls?.dispose(); } catch { /* Continue. */ }
    if (meshSet) {
      meshSet.meshes.forEach((mesh) => scene.remove(mesh));
      disposeFieldMeshes(meshSet.meshes);
    }
    try { renderer?.dispose(); } catch { /* Nothing remains after renderer disposal. */ }
  };

  try {
    renderer = environment.createRenderer(canvas);
    controls = environment.createControls(camera, canvas);
    environment.prefersReducedMotion();
    controls.enableDamping = false;
    controls.target.set(...model.grid.anchor.position);
    controls.update();
    scene.add(new THREE.HemisphereLight(0xdcefff, 0x101724, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(5, 8, 12);
    scene.add(key);
    meshSet = createFieldMeshes(model.grid, model.currentInstances, model.alternativeLayers);
    scene.add(...meshSet.meshes);
    observer = environment.createResizeObserver(([entry]) => {
      if (disposed || !entry || !renderer) return;
      const rawDpr = environment.devicePixelRatio();
      const validDpr = Number.isFinite(rawDpr) && rawDpr > 0;
      const actualDpr = validDpr ? rawDpr : 1;
      const renderDpr = Math.min(MAX_RENDER_DPR, Math.max(1, actualDpr));
      const deviceSize = validDpr ? entry.devicePixelContentBoxSize?.[0] : undefined;
      width = Math.max(1, deviceSize ? deviceSize.inlineSize / actualDpr : entry.contentRect.width);
      height = Math.max(1, deviceSize ? deviceSize.blockSize / actualDpr : entry.contentRect.height);
      renderer.setPixelRatio(renderDpr);
      renderer.setSize(width, height, false);
      scheduleRender();
    });
    try {
      observer.observe(canvas, { box: "device-pixel-content-box" });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      observer.observe(canvas);
    }
    controls.addEventListener("change", scheduleRender);
    controlsListening = true;
    scheduleRender();
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    dispose,
    setHighlightedBranch(branchRevision) {
      if (disposed || !meshSet) return;
      highlightFieldMesh(meshSet.ghostMaterials, branchRevision);
      scheduleRender();
    },
  };
}
