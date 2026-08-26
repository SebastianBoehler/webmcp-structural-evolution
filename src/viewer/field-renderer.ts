import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { AlternativeLayer } from "./alternative-instances";
import {
  createFieldMeshes,
  disposeFieldMeshes,
  highlightFieldMesh,
  type FieldMeshSet,
} from "./field-meshes";
import {
  assertFiniteF32,
  fieldInstanceCount,
  type InstanceRecord,
  type VoxelGrid,
} from "./field-instances";

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

function validateInstanceF32(
  record: InstanceRecord,
  grid: VoxelGrid,
  offset: readonly number[],
  label: string,
): void {
  if (!Array.isArray(record.localPosition) || record.localPosition.length !== 3) {
    throw new RangeError(`${label} local position must contain exactly 3 values`);
  }
  const localReach = record.localPosition.reduce((sum, value, axis) => {
    assertFiniteF32(value, `${label} local position[${axis}]`);
    return sum + Math.abs(value);
  }, 0);
  grid.anchor.position.forEach((position, axis) => {
    assertFiniteF32(
      Math.abs(position + offset[axis]!) + localReach,
      `${label} assembly position[${axis}]`,
    );
  });
}

function validateRenderModelF32(model: ViewerRenderModel): void {
  fieldInstanceCount(model.grid);
  model.currentInstances.forEach((record, index) => {
    validateInstanceF32(record, model.grid, [0, 0, 0], `current instance[${index}]`);
  });
  model.alternativeLayers.forEach((layer, layerIndex) => {
    fieldInstanceCount(layer.grid);
    if (!Array.isArray(layer.displayOffset) || layer.displayOffset.length !== 3) {
      throw new RangeError(`alternative layer[${layerIndex}] offset must contain exactly 3 values`);
    }
    layer.displayOffset.forEach((value, axis) => {
      assertFiniteF32(value, `alternative layer[${layerIndex}] offset[${axis}]`);
      assertFiniteF32(
        layer.grid.anchor.position[axis] + value,
        `alternative layer[${layerIndex}] transform[${axis}]`,
      );
    });
    [...layer.added, ...layer.removed].forEach((record, instanceIndex) => {
      validateInstanceF32(
        record,
        layer.grid,
        layer.displayOffset,
        `alternative layer[${layerIndex}] instance[${instanceIndex}]`,
      );
    });
  });
}

export function mountFieldRenderer(
  canvas: HTMLCanvasElement,
  model: ViewerRenderModel,
  environment: FieldViewerEnvironment,
): FieldRendererSession {
  validateRenderModelF32(model);
  let renderer: RendererLike | undefined;
  let controls: ControlsLike | undefined;
  let observer: ObserverLike | undefined;
  let meshSet: FieldMeshSet | undefined;
  let controlsListening = false;
  let frame: number | undefined;
  let inactive = false;
  let disposing = false;
  let teardownComplete = false;
  const scene = new THREE.Scene();
  const camera = cameraFor(model.grid);
  let width = 1;
  let height = 1;
  const render = () => {
    frame = undefined;
    if (inactive || !renderer) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const scheduleRender = () => {
    if (!inactive && frame === undefined) frame = environment.requestFrame(render);
  };
  const attempt = (action: (() => void) | undefined) => {
    try {
      action?.();
    } catch {
      // dispose() has no error channel; teardown is best-effort after every owner is attempted.
    }
  };
  const dispose = () => {
    if (teardownComplete || disposing) return;
    inactive = true;
    disposing = true;
    try {
      if (frame !== undefined) attempt(() => environment.cancelFrame(frame!));
      frame = undefined;
      attempt(observer ? () => observer!.disconnect() : undefined);
      if (controlsListening) {
        attempt(controls ? () => controls!.removeEventListener("change", scheduleRender) : undefined);
      }
      attempt(controls ? () => controls!.dispose() : undefined);
      if (meshSet) {
        meshSet.meshes.forEach((mesh) => attempt(() => scene.remove(mesh)));
        attempt(() => disposeFieldMeshes(meshSet!.meshes));
      }
      attempt(renderer ? () => renderer!.dispose() : undefined);
      teardownComplete = true;
    } finally {
      disposing = false;
    }
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
      if (inactive || !entry || !renderer) return;
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
      if (inactive || !meshSet) return;
      highlightFieldMesh(meshSet.ghostMaterials, branchRevision);
      scheduleRender();
    },
  };
}
