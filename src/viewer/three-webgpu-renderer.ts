import type * as THREE from "three";

import {
  addSemanticScene,
  configureSemanticReferenceGrid,
  semanticSceneBounds,
} from "./semantic-three-scene";
import { createWebGpuCameraControls } from "./webgpu-camera-controls";
import { observeWebGpuCanvasContainer, sizeWebGpuCanvas } from "./webgpu-canvas-sizing";
import { createWebGpuPbrMaterialFactory } from "./webgpu-pbr-material";
import { createWebGpuResizeSession, type WebGpuResizeSession } from "./webgpu-resize-session";
import { blobFromCanvas, renderEnvelope } from "./webgpu-renderer-helpers";
import {
  createWebGpuSemanticInteraction,
  createSelectedSemanticGizmo,
} from "./webgpu-semantic-interaction";
import { createWebGpuTransformDrag } from "./webgpu-transform-drag";
import {
  type WebGpuTransformGizmo,
} from "./webgpu-transform-gizmo";
import type {
  SemanticInteractionHandlers,
  SemanticRenderer,
  SemanticView,
  ViewportGpuDevice,
} from "./webgpu-renderer-types";

interface InitializableRenderer {
  init(): Promise<unknown>;
  dispose(): void;
}

export async function initializeThreeRenderer<Value>(
  renderer: InitializableRenderer,
  setup: () => Promise<Value> | Value,
): Promise<Value> {
  try {
    await renderer.init();
    return await setup();
  } catch (error) {
    renderer.dispose();
    throw error;
  }
}

export async function createThreeWebGpuRenderer(
  device: ViewportGpuDevice,
  canvas: HTMLCanvasElement,
): Promise<SemanticRenderer> {
  const [three, rendererModule, backendModule, libraryModule, materialModule,
    materialNodeModule, instanceNodeModule] = await Promise.all([
    import("three"),
    import("three/src/renderers/common/Renderer.js"),
    import("three/src/renderers/webgpu/WebGPUBackend.js"),
    import("three/src/renderers/webgpu/nodes/StandardNodeLibrary.js"),
    import("three/src/materials/nodes/MeshStandardNodeMaterial.js"),
    import("three/src/nodes/accessors/MaterialNode.js"),
    import("three/src/nodes/accessors/Instance.js"),
  ]);
  const backend = new backendModule.default({
    canvas,
    device: device as GPUDevice,
    alpha: true,
  });
  const renderer = new rendererModule.default(backend, { alpha: true, antialias: true });
  renderer.library = new libraryModule.default();
  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(38, 1, .1, 100000);
  const raycaster = new three.Raycaster();
  const pbr = createWebGpuPbrMaterialFactory({
    createMaterial: (parameters) => new materialModule.default(parameters),
    materialColor: materialNodeModule.materialColor,
    instanceColor: instanceNodeModule.instanceColor,
  });
  let release: () => void = () => undefined;
  let handlers: SemanticInteractionHandlers = {};
  let focused: string | undefined;
  let gridVisible = true;
  let disposed = false;
  let transformSpace: "world" | "local" = "world";
  let gizmo: WebGpuTransformGizmo | undefined;
  const navigation = await initializeThreeRenderer(renderer, async () => {
    const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
    return createWebGpuCameraControls(
      OrbitControls,
      camera,
      canvas,
      () => {
        if (!disposed) renderer.render(scene, camera);
      },
    );
  });
  const transform = createWebGpuTransformDrag({
    orbitEnabled: navigation.isEnabled,
    setOrbitEnabled: navigation.setEnabled,
    onMove: (semanticId, position) => handlers.onMove?.(semanticId, position),
    onPreview: () => {
      gizmo?.sync();
      if (!disposed) renderer.render(scene, camera);
    },
    onMoveError: (error) => handlers.onMoveError?.(error),
    onDragState: (dragging, semanticId) => {
      handlers.onDragState?.(dragging, semanticId);
    },
  });
  let frameData: { readonly bounds: THREE.Box3;
    readonly target: readonly [number, number, number] } | undefined;
  let resize: WebGpuResizeSession;
  try {
    resize = createWebGpuResizeSession({
      observe(callback) {
        return observeWebGpuCanvasContainer(canvas, callback);
      },
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      onResize(width, height) {
        sizeWebGpuCanvas(renderer, width, height);
        if (frameData) navigation.refit(frameData.bounds, frameData.target, width / height);
      },
      render: () => { if (!disposed) renderer.render(scene, camera); },
    });
  } catch (error) {
    transform.dispose();
    navigation.dispose();
    renderer.dispose();
    throw error;
  }
  const interaction = createWebGpuSemanticInteraction(three, {
    canvas, scene, camera, raycaster, transform,
    handlers: () => handlers,
    gizmo: () => gizmo,
  });

  return {
    async render(state) {
      gizmo?.dispose();
      gizmo = undefined;
      release();
      release = addSemanticScene(three, scene, state, gridVisible, pbr);
      const bounds = semanticSceneBounds(three, scene);
      const envelope = renderEnvelope(bounds.min.toArray(), bounds.max.toArray());
      configureSemanticReferenceGrid(scene, bounds, envelope);
      const selected = state.selection
        ? scene.getObjectByName(`semantic:${state.selection}`)
        : undefined;
      gizmo = createSelectedSemanticGizmo(
        three, scene, selected, transformSpace, Math.max(envelope.span * .3, .001),
      );
      const target = focused
        ? new three.Box3()
          .setFromObject(scene.getObjectByName(`semantic:${focused}`) ?? scene)
          .getCenter(new three.Vector3())
          .toArray()
        : envelope.target;

      const rect = (canvas.parentElement ?? canvas).getBoundingClientRect();
      const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
      frameData = { bounds, target };
      navigation.frame(bounds, target, width / height);
      sizeWebGpuCanvas(renderer, width, height);
      renderer.render(scene, camera);
      return blobFromCanvas(canvas);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      interaction.dispose();
      resize.dispose();
      transform.dispose();
      navigation.dispose();
      gizmo?.dispose();
      release();
      renderer.dispose();
    },
    onDeviceLost() {},
    setInteractionHandlers(next) { handlers = next; },
    setView(next: SemanticView) { navigation.setView(next); },
    focus(next) {
      focused = next;
      navigation.focus();
    },
    setGridVisible(next) { gridVisible = next; },
    setTransformOptions(space, snap) {
      transformSpace = space;
      transform.setOptions(space, snap);
      gizmo?.setSpace(space);
    },
  };
}
