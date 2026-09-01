import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface ResizeEntryLike {
  readonly devicePixelContentBoxSize?: readonly { readonly inlineSize: number; readonly blockSize: number }[];
  readonly contentRect: { readonly width: number; readonly height: number };
}

export interface RendererLike {
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

export interface FieldRendererEnvironmentOptions {
  readonly preserveDrawingBuffer?: boolean;
}

export interface ControlsLike {
  enableDamping: boolean;
  enablePan?: boolean;
  screenSpacePanning?: boolean;
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
  readonly createRenderer: (canvas: HTMLCanvasElement, options?: FieldRendererEnvironmentOptions) => RendererLike;
  readonly createControls: (camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) => ControlsLike;
  readonly createResizeObserver: (callback: (entries: readonly ResizeEntryLike[]) => void) => ObserverLike;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly devicePixelRatio: () => number;
  readonly prefersReducedMotion: () => boolean;
}

const defaultEnvironment: FieldViewerEnvironment = {
  createRenderer: (canvas, options) => {
    const renderer = new THREE.WebGLRenderer({
      alpha: true, antialias: true, canvas, preserveDrawingBuffer: options?.preserveDrawingBuffer ?? false,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    return renderer;
  },
  createControls: (camera, canvas) => new OrbitControls(camera, canvas),
  createResizeObserver: (callback) => new ResizeObserver((entries) => callback(entries)),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  devicePixelRatio: () => window.devicePixelRatio || 1,
  prefersReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

export function viewerEnvironment(override: FieldViewerEnvironment | undefined): FieldViewerEnvironment {
  return override ?? defaultEnvironment;
}
