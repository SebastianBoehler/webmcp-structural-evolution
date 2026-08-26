import * as THREE from "three";
import { vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import type { SelectedSemanticRegion, ViewerBranch } from "./alternative-instances";
import type { FieldViewerEnvironment, ResizeEntryLike } from "./FieldViewer";
import type { VoxelGrid } from "./field-instances";

export const grid: VoxelGrid = {
  dimensions: { width: 2, height: 2, depth: 1 },
  cellSize: [1, 1, 1],
  anchor: { position: [5, 7, 11], orientation: [0, 0, 0, 1] },
};

export const region: SelectedSemanticRegion = {
  id: "arm-rib",
  label: "Arm rib",
  min: [0, 0, 0],
  maxExclusive: [2, 2, 1],
};

export function verified(values: ArrayLike<number>): ProbeResult {
  return {
    status: "verified",
    output: new Float32Array(values),
    elapsedMs: 1,
    relativeL2: 0,
    tolerance: 0.000005,
  };
}

export const current: ViewerBranch = {
  branchRevision: "accepted",
  contextRevision: "accepted-context",
  parentRevision: "root",
  grid,
  result: verified([1, 1, 0, 1]),
};

export const alternative: ViewerBranch = {
  branchRevision: "lighter",
  contextRevision: "accepted-context",
  parentRevision: "accepted-context",
  grid,
  result: verified([1, 0, 1, 1]),
};

export interface TestHarness {
  readonly environment: FieldViewerEnvironment;
  readonly renderer: {
    setPixelRatio: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  readonly controls: {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    enableDamping: boolean;
    target: { set: ReturnType<typeof vi.fn> };
  };
  emitResize(entry: ResizeEntryLike): void;
  emitControlChange(): void;
  flushFrame(): void;
  readonly observe: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly cancelFrame: ReturnType<typeof vi.fn>;
}

interface HarnessOptions {
  readonly dpr?: number;
  readonly rejectDevicePixelObserve?: boolean;
  readonly controlsFailure?: Error;
  readonly observerFailure?: Error;
  readonly frameFailure?: Error;
}

export function harness(options: HarnessOptions = {}): TestHarness {
  let resizeCallback: (entries: readonly ResizeEntryLike[]) => void = () => undefined;
  let controlCallback: () => void = () => undefined;
  let frame: FrameRequestCallback | undefined;
  const renderer = {
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  };
  const controls = {
    addEventListener: vi.fn((_type: "change", callback: () => void) => {
      controlCallback = callback;
    }),
    removeEventListener: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
    enableDamping: true,
    target: { set: vi.fn() },
  };
  const disconnect = vi.fn();
  const cancelFrame = vi.fn();
  const observe = vi.fn((_target: Element, observerOptions?: ResizeObserverOptions) => {
    if (options.rejectDevicePixelObserve && observerOptions) throw new TypeError("box unsupported");
  });
  return {
    renderer,
    controls,
    disconnect,
    cancelFrame,
    observe,
    environment: {
      createRenderer: vi.fn(() => renderer),
      createControls: vi.fn(() => {
        if (options.controlsFailure) throw options.controlsFailure;
        return controls;
      }),
      createResizeObserver: vi.fn((callback) => {
        if (options.observerFailure) throw options.observerFailure;
        resizeCallback = callback;
        return { observe, disconnect };
      }),
      requestFrame: vi.fn((callback) => {
        if (options.frameFailure) throw options.frameFailure;
        frame = callback;
        return 7;
      }),
      cancelFrame,
      devicePixelRatio: () => options.dpr ?? 2,
      prefersReducedMotion: () => true,
    },
    emitResize: (entry) => resizeCallback([entry]),
    emitControlChange: () => controlCallback(),
    flushFrame: () => {
      const callback = frame;
      frame = undefined;
      callback?.(0);
    },
  };
}

export function renderedMeshes(test: TestHarness): THREE.InstancedMesh[] {
  test.flushFrame();
  const scene = test.renderer.render.mock.calls.at(-1)?.[0] as THREE.Scene;
  const meshes: THREE.InstancedMesh[] = [];
  scene.traverse((child) => {
    if (child instanceof THREE.InstancedMesh) meshes.push(child);
  });
  return meshes;
}
