import type { ResultLayer, ResultLayerPayloads } from "./result-layers";
import type { SemanticDocumentArtifact } from "./semantic-scene";

type SectionPlane = Readonly<{
  normal: readonly [number, number, number];
  constant: number;
}>;
type Measurement = Readonly<{
  from: readonly [number, number, number];
  to: readonly [number, number, number];
}>;

export interface ViewportGpuDevice {
  readonly lost?: Promise<{ readonly reason: string; readonly message: string }>;
  destroy?(): void;
}
export interface WebGpuDeviceLossInfo { readonly reason: string; readonly message: string }

export interface SemanticRenderState {
  readonly document: SemanticDocumentArtifact;
  readonly revision: string;
  readonly selection?: string;
  readonly resultLayers: Readonly<Partial<ResultLayerPayloads>>;
  readonly sectionPlane?: SectionPlane;
  readonly measurements: readonly Measurement[];
}

export interface SemanticInteractionHandlers {
  readonly onSelect?: (semanticId: string) => void;
  readonly onMove?: (
    semanticId: string,
    position: readonly [number, number, number],
  ) => unknown;
  readonly onMoveError?: (error: unknown) => void;
  readonly onDragState?: (dragging: boolean, semanticId: string) => void;
}

export type SemanticView = "isometric" | "top" | "front" | "right";

export interface SemanticRenderer {
  render(state: SemanticRenderState): Promise<Blob>;
  present(state: SemanticRenderState): Promise<void>;
  dispose(): void;
  onDeviceLost(info: { readonly reason: string; readonly message: string }): void;
  setInteractionHandlers?(handlers: SemanticInteractionHandlers): void;
  setView?(view: SemanticView): void;
  focus?(semanticId: string | undefined): void;
  setGridVisible?(visible: boolean): void;
  setTransformOptions?(space: "world" | "local", snap: number | null): void;
}

export interface SemanticViewportEnvironment {
  acquireDevice(): Promise<ViewportGpuDevice>;
  createRenderer(
    device: ViewportGpuDevice,
    canvas: HTMLCanvasElement,
  ): Promise<SemanticRenderer>;
  createFallbackRenderer?: () => never;
  readonly ownsDevice?: boolean;
}

export interface SemanticViewport {
  setDocument(document: SemanticDocumentArtifact): void;
  setSelection(selection: string | undefined): void;
  setResultLayer<K extends ResultLayer>(
    layer: K,
    payload: ResultLayerPayloads[K] | undefined,
  ): void;
  setMechanismFrame(frame: ResultLayerPayloads["mechanism"] | undefined): void;
  setSectionPlane(plane: SemanticRenderState["sectionPlane"]): void;
  setMeasurements(measurements: SemanticRenderState["measurements"]): void;
  setInteractionHandlers(handlers: SemanticInteractionHandlers): void;
  setView(view: SemanticView): void;
  focus(selection: string | undefined): void;
  setGridVisible(visible: boolean): void;
  setTransformOptions(space: "world" | "local", snap: number | null): void;
  capture(signal?: AbortSignal): Promise<Blob>;
  present(): Promise<void>;
  onDeviceLost(listener: (info: WebGpuDeviceLossInfo) => void): () => void;
  dispose(): void;
}
