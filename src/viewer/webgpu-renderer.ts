import { createResultLayers } from "./result-layers";
import { repairSemanticSelection } from "./semantic-picking";
import { validateSemanticDocument, type SemanticDocumentArtifact } from "./semantic-scene";
import { createThreeWebGpuRenderer } from "./three-webgpu-renderer";
import {
  abortError,
  acquireBrowserDevice,
  renderEnvelope,
} from "./webgpu-renderer-helpers";
import type {
  SemanticRenderer,
  SemanticRenderState,
  SemanticViewport,
  SemanticViewportEnvironment,
} from "./webgpu-renderer-types";

export { renderEnvelope } from "./webgpu-renderer-helpers";
export type { RenderEnvelope } from "./webgpu-renderer-helpers";
export type {
  SemanticInteractionHandlers,
  SemanticRenderer,
  SemanticRenderState,
  SemanticView,
  SemanticViewport,
  SemanticViewportEnvironment,
  ViewportGpuDevice,
} from "./webgpu-renderer-types";

const browserEnvironment: SemanticViewportEnvironment = {
  acquireDevice: acquireBrowserDevice,
  createRenderer: createThreeWebGpuRenderer,
};

export async function createSemanticViewport(
  canvas: HTMLCanvasElement,
  environment: SemanticViewportEnvironment = browserEnvironment,
): Promise<SemanticViewport> {
  const device = await environment.acquireDevice();
  let renderer: SemanticRenderer;
  try {
    renderer = await environment.createRenderer(device, canvas);
  } catch (error) {
    if (environment.ownsDevice !== false) device.destroy?.();
    throw error;
  }

  const layers = createResultLayers();
  let document: SemanticDocumentArtifact | undefined;
  let selection: string | undefined;
  let sectionPlane: SemanticRenderState["sectionPlane"];
  let measurements: SemanticRenderState["measurements"] = [];
  let disposed = false;
  const lossListeners = new Set<(info: { readonly reason: string; readonly message: string }) => void>();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    lossListeners.clear();
    renderer.dispose();
    if (environment.ownsDevice !== false) device.destroy?.();
  };
  void device.lost?.then((info) => {
    if (disposed) return;
    try {
      renderer.onDeviceLost(info);
      for (const listener of [...lossListeners]) listener(info);
    } finally {
      dispose();
    }
  });

  return {
    setDocument(next) {
      if (disposed) return;
      document = validateSemanticDocument(next);
      selection = repairSemanticSelection(
        selection,
        document,
        document.selectionRepairs,
      ).selection;
    },
    setSelection(next) {
      if (next && document && !document.nodes.some((node) => node.id === next)) {
        throw new Error(`unknown semantic selection: ${next}`);
      }
      selection = next;
    },
    setResultLayer(layer, payload) {
      if (!disposed) layers.set(layer, payload);
    },
    setMechanismFrame(frame) {
      if (!disposed) layers.set("mechanism", frame);
    },
    setSectionPlane(next) { sectionPlane = next; },
    setMeasurements(next) { measurements = [...next]; },
    setInteractionHandlers(next) { renderer.setInteractionHandlers?.(next); },
    setView(next) { renderer.setView?.(next); },
    focus(next) { renderer.focus?.(next); },
    setGridVisible(next) { renderer.setGridVisible?.(next); },
    setTransformOptions(space, snap) {
      renderer.setTransformOptions?.(space, snap);
    },
    async capture(signal) {
      if (signal?.aborted) throw abortError();
      if (disposed) {
        throw new Error("WebGPU viewport is unavailable after disposal or device loss.");
      }
      if (!document) {
        throw new Error("A semantic document artifact is required before capture.");
      }
      const output = await renderer.render({
        document,
        revision: document.revision,
        selection,
        resultLayers: layers.snapshot(),
        sectionPlane,
        measurements,
      });
      if (signal?.aborted) throw abortError();
      return output;
    },
    onDeviceLost(listener) {
      if (disposed) return () => undefined;
      lossListeners.add(listener);
      return () => lossListeners.delete(listener);
    },
    dispose,
  };
}
