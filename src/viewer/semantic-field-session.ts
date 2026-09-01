import type { FlightFrame } from "../simulation/flight-scenarios";
import type { AssemblyVisualPart, ViewerRenderModel } from "./render-envelope";
import { semanticArtifactFromViewerModel, type SemanticDocumentArtifact } from "./semantic-scene";
import { componentIdForSourceSelection, sourceSelectionForSemantic } from "./semantic-picking";
import { createSemanticViewport } from "./webgpu-renderer";
import type { FieldRendererSession } from "./field-renderer";
import type { PartInteractionHandlers } from "./assembly-interactions";
import type { WebGpuDeviceLossInfo } from "./webgpu-renderer-types";

export class SemanticDeviceLostError extends Error {
  readonly name = "SemanticDeviceLostError";
  constructor(readonly info: WebGpuDeviceLossInfo) {
    super(`WebGPU device lost: ${info.message || info.reason}`);
  }
}

export interface SemanticFieldRendererSession extends FieldRendererSession {
  updateModel(model: ViewerRenderModel, revision?: string): Promise<void>;
}

export interface SemanticCaptureLifecycle {
  readonly revision: string;
  readonly state: "initializing" | "ready" | "error";
  readonly error?: unknown;
}

export function flightFrameTransform([roll, pitch, yaw]: readonly [number, number, number]): readonly number[] {
  const cx = Math.cos(roll), sx = Math.sin(roll), cy = Math.cos(pitch), sy = Math.sin(pitch), cz = Math.cos(yaw), sz = Math.sin(yaw);
  return [cz * cy, sz * cy, -sy, 0, cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx, 0,
    cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx, 0, 0, 0, 0, 1];
}

function show(viewport: Awaited<ReturnType<typeof createSemanticViewport>>, onError?: (error: unknown) => void) {
  void viewport.capture().catch((error) => onError?.(error));
}

function analysisLayers(viewport: Awaited<ReturnType<typeof createSemanticViewport>>, model: ViewerRenderModel) {
  const { dimensions, cellSize, anchor } = model.grid;
  const grid = { dimensions: [dimensions.width, dimensions.height, dimensions.depth] as const, cellSize, origin: anchor.position, active: new Uint8Array(dimensions.width * dimensions.height * dimensions.depth).map((_value, index) => model.currentInstances.includes(index) ? 1 : 0) };
  if (model.densityField) viewport.setResultLayer("topology", { density: model.densityField, ...grid });
  const field = model.analysisField;
  if (!field) return;
  const scalar = { values: field.values, maximum: field.maximum, ...grid };
  if (field.kind === "heat-flux") {
    if (!field.vectors || field.vectorUnit !== "W/m^2") {
      throw new Error("heat-flux fields require signed W/m^2 vectors");
    }
    viewport.setResultLayer("flux", { ...scalar, vectors: field.vectors, vectorUnit: field.vectorUnit });
  } else if (field.kind === "displacement") {
    if (!field.vectors || field.displacementUnit !== "mm") {
      throw new Error("displacement fields require signed millimetre vectors");
    }
    viewport.setResultLayer("displacement", { ...scalar, vectors: field.vectors,
      displacementUnit: field.displacementUnit,
      ...(field.sourceDisplacementUnit ? { sourceDisplacementUnit: field.sourceDisplacementUnit } : {}) });
  } else viewport.setResultLayer(field.kind === "safety" ? "stress" : field.kind, scalar);
}

export async function mountSemanticFieldSession(
  canvas: HTMLCanvasElement,
  model: ViewerRenderModel,
  revision: string,
  onError?: (error: unknown) => void,
  interactions: PartInteractionHandlers = {},
  onCapture?: (event: SemanticCaptureLifecycle) => void,
  selectionIsControlled: () => boolean = () => Boolean(interactions.onSelect),
): Promise<SemanticFieldRendererSession> {
  const viewport = await createSemanticViewport(canvas);
  let disposed = false;
  const stopLoss = viewport.onDeviceLost((info) => onError?.(new SemanticDeviceLostError(info)));
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopLoss();
    viewport.dispose();
  };
  let assemblyParts = model.assemblyParts;
  let currentModel = model, currentRevision = revision;
  let currentArtifact: SemanticDocumentArtifact;
  let selectedComponent: string | undefined;
  let pendingControlledEcho: string | undefined;
  let transformSpace: "world" | "local" = "world";
  let translationSnap: number | null = null;
  const setDocument = () => {
    const artifact = semanticArtifactFromViewerModel({ ...currentModel, assemblyParts }, currentRevision);
    currentArtifact = artifact;
    viewport.setDocument(artifact);
    for (const layer of ["topology", "displacement", "stress", "temperature", "flux"] as const) viewport.setResultLayer(layer, undefined);
    analysisLayers(viewport, currentModel);
  };
  const captureRevision = async (revision: string) => {
    onCapture?.({ revision, state: "initializing" });
    try {
      setDocument();
      await viewport.capture();
      onCapture?.({ revision, state: "ready" });
    } catch (error) {
      onCapture?.({ revision, state: "error", error });
      throw error;
    }
  };
  try {
    viewport.setInteractionHandlers({
      onSelect: (semanticId) => {
        viewport.setSelection(semanticId);
        show(viewport, onError);
        const source = sourceSelectionForSemantic(currentArtifact, semanticId);
        pendingControlledEcho = selectionIsControlled() ? source : undefined;
        if (source) interactions.onSelect?.(source);
      },
      onMove: (semanticId, position) => {
        const source = sourceSelectionForSemantic(currentArtifact, semanticId);
        if (source) interactions.onMove?.(source, position);
      },
      onDragState: (dragging, semanticId) => {
        const source = sourceSelectionForSemantic(currentArtifact, semanticId);
        if (source) interactions.onDragState?.(dragging, source);
      },
    });
    await captureRevision(currentRevision);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    dispose,
    setHighlightedBranch() { /* alternative overlays are result-layer data, not document state */ },
    setSelectedPart(selection) {
      selectedComponent = selection
        ? componentIdForSourceSelection(currentArtifact, selection) : undefined;
      if (selection && pendingControlledEcho === selection && selectedComponent) {
        pendingControlledEcho = undefined;
        return;
      }
      pendingControlledEcho = undefined;
      viewport.setSelection(selectedComponent);
      show(viewport, onError);
    },
    setAssemblyPartPoses(parts: readonly AssemblyVisualPart[]) {
      assemblyParts = parts; setDocument(); show(viewport, onError);
    },
    focusSelectedPart() { viewport.focus(selectedComponent); show(viewport, onError); },
    setFlightFrame(frame: FlightFrame | undefined) {
      if (!frame) return;
      viewport.setMechanismFrame({ componentId: "assembly:design", transform: flightFrameTransform(frame.attitudeRad) });
      show(viewport, onError);
    },
    setReferenceGridVisible(visible) { viewport.setGridVisible(visible); show(viewport, onError); },
    setView(view) { viewport.setView(view); show(viewport, onError); },
    setTransformSpace(space) {
      transformSpace = space;
      viewport.setTransformOptions(transformSpace, translationSnap);
    },
    setTranslationSnap(distance) {
      translationSnap = distance;
      viewport.setTransformOptions(transformSpace, translationSnap);
    },
    async updateModel(next, nextRevision = currentRevision) {
      currentModel = next; currentRevision = nextRevision; assemblyParts = next.assemblyParts;
      await captureRevision(nextRevision);
    },
  };
}
