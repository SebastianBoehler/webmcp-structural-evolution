import type { FlightFrame } from "../simulation/flight-scenarios";
import type { AssemblyVisualPart, ViewerRenderModel } from "./render-envelope";
import { semanticArtifactFromViewerModel, type SemanticDocumentArtifact } from "./semantic-scene";
import { componentIdForSourceSelection, sourceSelectionForSemantic } from "./semantic-picking";
import { createSemanticViewport } from "./webgpu-renderer";
import type { FieldRendererSession } from "./field-renderer";
import type { PartInteractionHandlers } from "./assembly-interactions";
import type { WebGpuDeviceLossInfo } from "./webgpu-renderer-types";
import { materializeSemanticModelParts } from "./semantic-model-materializer";

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

function show(viewport: Awaited<ReturnType<typeof createSemanticViewport>>, onError?: (error: unknown) => void,
  current: () => boolean = () => true) {
  if (!current()) return;
  void viewport.capture().catch((error) => { if (current()) onError?.(error); });
}

function analysisLayers(viewport: Awaited<ReturnType<typeof createSemanticViewport>>, model: ViewerRenderModel,
  solverCase?: string) {
  const { dimensions, cellSize, anchor } = model.grid;
  const grid = { dimensions: [dimensions.width, dimensions.height, dimensions.depth] as const, cellSize, origin: anchor.position, active: new Uint8Array(dimensions.width * dimensions.height * dimensions.depth).map((_value, index) => model.currentInstances.includes(index) ? 1 : 0) };
  if (model.densityField) viewport.setResultLayer("topology", { density: model.densityField, ...grid });
  const field = model.analysisField;
  if (!field) return;
  const active = solverCase ? field.cases?.[solverCase] : undefined;
  const scalar = { values: active?.values ?? field.values, maximum: active?.maximum ?? field.maximum, ...grid };
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
  } else if (field.kind === "displacement-magnitude") {
    viewport.setResultLayer("displacementMagnitude", scalar);
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
  let assemblyParts: readonly AssemblyVisualPart[] | undefined;
  let currentModel = model, currentRevision = revision;
  let currentArtifact: SemanticDocumentArtifact;
  let selectedComponent: string | undefined;
  let pendingControlledEcho: string | undefined;
  let transformSpace: "world" | "local" = "world";
  let translationSnap: number | null = null;
  let flightFrameActive = false;
  let activeSolverCase: string | undefined;
  let generation = 0;
  const current = (request: number) => !disposed && generation === request;
  const setDocument = async (source: ViewerRenderModel, sourceRevision: string, request: number) => {
    const parts = await materializeSemanticModelParts(source.assemblyParts ?? []);
    if (!current(request)) return false;
    assemblyParts = parts;
    const artifact = semanticArtifactFromViewerModel({ ...source, assemblyParts }, sourceRevision);
    currentArtifact = artifact;
    viewport.setDocument(artifact);
    for (const layer of ["topology", "displacement", "displacementMagnitude", "stress", "temperature", "flux"] as const) viewport.setResultLayer(layer, undefined);
    analysisLayers(viewport, source);
    activeSolverCase = undefined;
    return true;
  };
  const captureRevision = async (source: ViewerRenderModel, sourceRevision: string, request: number) => {
    try {
      const published = await setDocument(source, sourceRevision, request);
      if (!published || !current(request)) return;
      onCapture?.({ revision: sourceRevision, state: "initializing" });
      await viewport.capture();
      if (current(request)) onCapture?.({ revision: sourceRevision, state: "ready" });
    } catch (error) {
      if (!current(request)) return;
      onCapture?.({ revision: sourceRevision, state: "error", error });
      throw error;
    }
  };
  const restoreAuthoritativeModel = async (error: unknown) => {
    if (interactions.onMoveError) interactions.onMoveError(error);
    else onError?.(error);
    const request = ++generation;
    try { await captureRevision(currentModel, currentRevision, request); }
    catch (restoreError) { if (current(request)) onError?.(restoreError); }
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
        return source ? interactions.onMove?.(source, position) : undefined;
      },
      onMoveError: restoreAuthoritativeModel,
      onDragState: (dragging, semanticId) => {
        const source = sourceSelectionForSemantic(currentArtifact, semanticId);
        if (source) interactions.onDragState?.(dragging, source);
      },
    });
    const initialRequest = ++generation;
    await captureRevision(currentModel, currentRevision, initialRequest);
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
      const request = ++generation;
      const source = currentModel, sourceRevision = currentRevision;
      const setPoses = (materialized: readonly AssemblyVisualPart[]) => {
        if (!current(request)) return;
        assemblyParts = materialized;
        const artifact = semanticArtifactFromViewerModel({ ...source, assemblyParts }, sourceRevision);
        currentArtifact = artifact;
        viewport.setDocument(artifact);
        show(viewport, onError, () => current(request));
      };
      if (parts.some(({ kind }) => kind === "model")) {
        void materializeSemanticModelParts(parts).then(setPoses).catch((error) => {
          if (current(request)) onError?.(error);
        });
      } else setPoses(parts);
    },
    focusSelectedPart() { viewport.focus(selectedComponent); show(viewport, onError); },
    setFlightFrame(frame: FlightFrame | undefined) {
      if (!frame) {
        if (!flightFrameActive) return;
        flightFrameActive = false;
        activeSolverCase = undefined;
        analysisLayers(viewport, currentModel);
        viewport.setMechanismFrame(undefined);
        show(viewport, onError);
        return;
      }
      flightFrameActive = true;
      if (activeSolverCase !== frame.solverCase) {
        activeSolverCase = frame.solverCase;
        analysisLayers(viewport, currentModel, frame.solverCase);
      }
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
      const request = ++generation;
      currentModel = next; currentRevision = nextRevision;
      await captureRevision(next, nextRevision, request);
    },
  };
}
