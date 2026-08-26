import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  createFieldMeshes,
  highlightFieldMesh,
  type FieldMeshSet,
} from "./field-meshes";
import {
  prepareRenderModel,
  type CameraEnvelope,
  type ViewerRenderModel,
} from "./render-envelope";

export type { ViewerRenderModel } from "./render-envelope";

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

function cameraFor(envelope: CameraEnvelope): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(38, 1, envelope.near, envelope.far);
  camera.position.set(...envelope.position);
  camera.lookAt(...envelope.target);
  return camera;
}

interface CleanupOwner {
  complete: boolean;
  readonly release: () => void;
}

export function mountFieldRenderer(
  canvas: HTMLCanvasElement,
  model: ViewerRenderModel,
  environment: FieldViewerEnvironment,
): FieldRendererSession {
  const prepared = prepareRenderModel(model);
  let renderer: RendererLike | undefined;
  let controls: ControlsLike | undefined;
  let observer: ObserverLike | undefined;
  let meshSet: FieldMeshSet | undefined;
  let frame: number | undefined;
  let frameCleanupComplete = true;
  let inactive = false;
  let disposing = false;
  let cleanupComplete = false;
  const cleanupOwners: CleanupOwner[] = [];
  const scene = new THREE.Scene();
  const camera = cameraFor(prepared.camera);
  let width = 1;
  let height = 1;
  const render = () => {
    frame = undefined;
    frameCleanupComplete = true;
    if (inactive || !renderer) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const scheduleRender = () => {
    if (!inactive && frame === undefined) {
      frame = environment.requestFrame(render);
      frameCleanupComplete = false;
    }
  };
  const own = (release: () => void) => cleanupOwners.push({ complete: false, release });
  const attempt = (owner: CleanupOwner) => {
    if (owner.complete) return;
    try {
      owner.release();
      owner.complete = true;
    } catch {
      // The session has no teardown error channel; retain failed ownership for the next dispose().
    }
  };
  const dispose = () => {
    if (cleanupComplete || disposing) return;
    inactive = true;
    disposing = true;
    try {
      if (!frameCleanupComplete && frame !== undefined) {
        try {
          environment.cancelFrame(frame);
          frame = undefined;
          frameCleanupComplete = true;
        } catch {
          // Keep the pending handle owned so a later dispose() retries cancellation.
        }
      }
      cleanupOwners.forEach(attempt);
      cleanupComplete = frameCleanupComplete && cleanupOwners.every((owner) => owner.complete);
    } finally {
      disposing = false;
    }
  };

  try {
    renderer = environment.createRenderer(canvas);
    own(() => renderer!.dispose());
    controls = environment.createControls(camera, canvas);
    own(() => controls!.dispose());
    environment.prefersReducedMotion();
    controls.enableDamping = false;
    controls.target.set(...prepared.camera.target);
    controls.update();
    scene.add(new THREE.HemisphereLight(0xdcefff, 0x101724, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(5, 8, 12);
    scene.add(key);
    meshSet = createFieldMeshes(
      prepared.grid,
      prepared.currentInstances,
      prepared.alternativeLayers,
    );
    meshSet.meshes.forEach((mesh) => {
      own(() => scene.remove(mesh));
      own(() => mesh.dispose());
      own(() => mesh.geometry.dispose());
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => own(() => material.dispose()));
    });
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
    own(() => observer!.disconnect());
    try {
      observer.observe(canvas, { box: "device-pixel-content-box" });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      observer.observe(canvas);
    }
    controls.addEventListener("change", scheduleRender);
    own(() => controls!.removeEventListener("change", scheduleRender));
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
