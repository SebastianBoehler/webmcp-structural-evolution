import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { installAssemblyInteractions, type PartInteractionHandlers } from "./assembly-interactions";

import {
  createFieldMeshes,
  highlightFieldMesh,
  type FieldMeshSet,
} from "./field-meshes";
import {
  createAssemblyMeshes,
  highlightAssemblyPart,
  type AssemblyMeshSet,
} from "./assembly-meshes";
import { createCleanupLedger, type CleanupToken } from "./cleanup-ledger";
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
  enabled?: boolean;
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
  setSelectedPart(partId: string | undefined): void;
}

export class FieldRendererMountError extends Error {
  readonly cleanupSession: FieldRendererSession;

  constructor(cause: unknown, cleanupSession: FieldRendererSession) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "FieldRendererMountError";
    this.cleanupSession = cleanupSession;
  }
}

const defaultEnvironment: FieldViewerEnvironment = {
  createRenderer: (canvas) => {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas });
    renderer.setClearColor(0x000000, 0);
    return renderer;
  },
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

export function mountFieldRenderer(
  canvas: HTMLCanvasElement,
  model: ViewerRenderModel,
  environment: FieldViewerEnvironment,
  interactions: PartInteractionHandlers = {},
): FieldRendererSession {
  const prepared = prepareRenderModel(model);
  const ownership = createCleanupLedger();
  let renderer: RendererLike | undefined;
  let meshSet: FieldMeshSet | undefined;
  let assemblyMeshSet: AssemblyMeshSet | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let frame: number | undefined;
  let frameOwnership: CleanupToken | undefined;
  let inactive = false;
  let width = 1;
  let height = 1;
  const render = () => {
    frameOwnership?.relinquish();
    frameOwnership = undefined;
    frame = undefined;
    if (inactive || !renderer || !scene || !camera) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const scheduleRender = () => {
    if (!inactive && frame === undefined) {
      const handle = environment.requestFrame(render);
      frame = handle;
      frameOwnership = ownership.own(() => {
        environment.cancelFrame(handle);
        if (frame === handle) {
          frame = undefined;
          frameOwnership = undefined;
        }
      });
    }
  };
  const session: FieldRendererSession = {
    dispose() {
      inactive = true;
      ownership.dispose();
    },
    setHighlightedBranch(branchRevision) {
      if (inactive || !meshSet) return;
      highlightFieldMesh(meshSet.ghostMaterials, branchRevision);
      scheduleRender();
    },
    setSelectedPart(partId) {
      if (inactive || !assemblyMeshSet) return;
      highlightAssemblyPart(assemblyMeshSet.materials, partId);
      scheduleRender();
    },
  };

  try {
    scene = new THREE.Scene();
    camera = cameraFor(prepared.camera);
    const createdRenderer = environment.createRenderer(canvas);
    renderer = createdRenderer;
    ownership.own(() => createdRenderer.dispose());
    const createdControls = environment.createControls(camera, canvas);
    ownership.own(() => createdControls.dispose());
    environment.prefersReducedMotion();
    createdControls.enableDamping = false;
    createdControls.target.set(...prepared.camera.target);
    createdControls.update();
    const attach = (object: THREE.Object3D) => {
      ownership.own(() => scene!.remove(object));
      scene!.add(object);
    };
    attach(new THREE.HemisphereLight(0xdcefff, 0x101724, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(5, 8, 12);
    attach(key);
    assemblyMeshSet = createAssemblyMeshes(prepared.assemblyParts ?? [], {
      own: (release) => ownership.own(release),
      attach,
    }, scheduleRender);
    meshSet = createFieldMeshes(
      prepared.grid,
      prepared.currentInstances,
      prepared.alternativeLayers,
      {
        own: (release) => ownership.own(release),
        attach,
      },
    );
    const createdObserver = environment.createResizeObserver(([entry]) => {
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
    ownership.own(() => createdObserver.disconnect());
    try {
      createdObserver.observe(canvas, { box: "device-pixel-content-box" });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      createdObserver.observe(canvas);
    }
    ownership.own(() => createdControls.removeEventListener("change", scheduleRender));
    createdControls.addEventListener("change", scheduleRender);
    installAssemblyInteractions({
      canvas,
      camera,
      meshSet: assemblyMeshSet,
      controls: createdControls,
      handlers: interactions,
      scheduleRender,
      own: (release) => { ownership.own(release); },
    });
    scheduleRender();
  } catch (error) {
    session.dispose();
    throw new FieldRendererMountError(error, session);
  }

  return session;
}
