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
  parentRevision: "root",
  grid,
  result: verified([1, 1, 0, 1]),
};

export const alternative: ViewerBranch = {
  branchRevision: "lighter",
  parentRevision: "accepted",
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
  flushFrame(): void;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly cancelFrame: ReturnType<typeof vi.fn>;
}

export function harness(): TestHarness {
  let resizeCallback: (entries: readonly ResizeEntryLike[]) => void = () => undefined;
  let frame: FrameRequestCallback | undefined;
  const renderer = {
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  };
  const controls = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
    enableDamping: true,
    target: { set: vi.fn() },
  };
  const disconnect = vi.fn();
  const cancelFrame = vi.fn();
  return {
    renderer,
    controls,
    disconnect,
    cancelFrame,
    environment: {
      createRenderer: vi.fn(() => renderer),
      createControls: vi.fn(() => controls),
      createResizeObserver: vi.fn((callback) => {
        resizeCallback = callback;
        return { observe: vi.fn(), disconnect };
      }),
      requestFrame: vi.fn((callback) => {
        frame = callback;
        return 7;
      }),
      cancelFrame,
      devicePixelRatio: () => 2,
      prefersReducedMotion: () => true,
    },
    emitResize: (entry) => resizeCallback([entry]),
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
  return scene.children.filter(
    (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
  );
}
