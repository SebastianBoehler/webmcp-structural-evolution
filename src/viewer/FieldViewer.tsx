import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  extractAlternativeLayers,
  type AlternativeComparison,
  type AlternativeMode,
  type SelectedSemanticRegion,
  type ViewerBranch,
} from "./alternative-instances";
import {
  FieldRendererMountError,
  mountFieldRenderer,
  viewerEnvironment,
  type FieldRendererSession,
  type FieldViewerEnvironment,
  type ResizeEntryLike,
  type ViewerRenderModel,
} from "./field-renderer";
import { visibleInstances, type VoxelGrid } from "./field-instances";
import type { AssemblyVisualPart } from "./render-envelope";
import "./field-viewer.css";

export type { FieldViewerEnvironment, ResizeEntryLike } from "./field-renderer";

const EMPTY_ASSEMBLY_PARTS: readonly AssemblyVisualPart[] = Object.freeze([]);

export interface FieldViewerProps {
  readonly current: ViewerBranch | null;
  readonly alternatives: readonly ViewerBranch[];
  readonly selectedRegion: SelectedSemanticRegion;
  readonly threshold: number;
  readonly mode: AlternativeMode;
  readonly grid?: VoxelGrid;
  readonly assemblyParts?: readonly AssemblyVisualPart[];
  readonly selectedAlternative?: string;
  readonly selectedPart?: string;
  readonly statusText?: string;
  readonly environment?: FieldViewerEnvironment;
  readonly onPartSelect?: (partId: string) => void;
  readonly onPartMove?: (partId: string, center: readonly [number, number, number]) => void;
  readonly onPartDragState?: (dragging: boolean, partId: string) => void;
}

interface PreparedViewer {
  readonly model?: ViewerRenderModel;
  readonly comparisons: readonly AlternativeComparison[];
  readonly omittedCount: number;
  readonly error?: string;
  readonly notice?: string;
}

function assemblyModel(
  grid: VoxelGrid | undefined,
  assemblyParts: readonly AssemblyVisualPart[],
): ViewerRenderModel | undefined {
  return grid ? {
    grid,
    currentInstances: new Uint32Array(),
    alternativeLayers: [],
    assemblyParts,
  } : undefined;
}

function prepareViewer(
  current: ViewerBranch | null,
  alternatives: readonly ViewerBranch[],
  region: SelectedSemanticRegion,
  threshold: number,
  mode: AlternativeMode,
  selectedAlternative: string | undefined,
  fallbackGrid: VoxelGrid | undefined,
  assemblyParts: readonly AssemblyVisualPart[],
): PreparedViewer {
  const base = assemblyModel(current?.grid ?? fallbackGrid, assemblyParts);
  if (!current) return { model: base, comparisons: [], omittedCount: 0 };
  if (current.result.status !== "verified") {
    return {
      model: base,
      comparisons: [],
      omittedCount: 0,
      error: `${current.result.status}: ${current.result.message}; the unverified field is hidden.`,
    };
  }
  try {
    const extraction = extractAlternativeLayers(
      current, alternatives, region, threshold, mode, selectedAlternative,
    );
    let currentInstances = visibleInstances(current.result.output, current.grid, threshold);
    let notice: string | undefined;
    if (mode === "audition") {
      const audition = extraction.layers.find((layer) => layer.branchRevision === selectedAlternative);
      if (audition) currentInstances = audition.auditionInstances!;
      else notice = "Choose a verified alternative to audition. The accepted field remains visible.";
    }
    return {
      model: {
        grid: current.grid,
        currentInstances,
        densityField: mode === "audition"
          ? alternatives.find((branch) => branch.branchRevision === selectedAlternative)?.result.status === "verified"
            ? (alternatives.find((branch) => branch.branchRevision === selectedAlternative)!.result as { output: Float32Array }).output
            : current.result.output
          : current.result.output,
        alternativeLayers: mode === "audition" ? [] : extraction.layers,
        assemblyParts,
      },
      comparisons: extraction.comparisons,
      omittedCount: extraction.omittedCount,
      notice,
    };
  } catch (error) {
    return {
      model: base,
      comparisons: [],
      omittedCount: 0,
      error: `The verified field metadata is invalid, so the field is hidden. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function FieldViewer({
  current,
  alternatives,
  selectedRegion,
  threshold,
  mode,
  grid,
  assemblyParts = EMPTY_ASSEMBLY_PARTS,
  selectedAlternative,
  selectedPart,
  statusText,
  environment,
  onPartSelect,
  onPartMove,
  onPartDragState,
}: FieldViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<FieldRendererSession | null>(null);
  const descriptionId = useId();
  const [renderError, setRenderError] = useState<string>();
  const [view, setView] = useState<"isometric" | "top" | "front" | "right">("isometric");
  const [gridVisible, setGridVisible] = useState(true);
  const [worldCoordinates, setWorldCoordinates] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const auditionSelection = mode === "audition" ? selectedAlternative : undefined;
  const prepared = useMemo(() => prepareViewer(
    current,
    alternatives,
    selectedRegion,
    threshold,
    mode,
    auditionSelection,
    grid,
    assemblyParts,
  ), [current, alternatives, selectedRegion, threshold, mode, auditionSelection, grid, assemblyParts]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !prepared.model) return;
    setRenderError(undefined);
    try {
      const session = mountFieldRenderer(
        canvas,
        prepared.model,
        viewerEnvironment(environment),
        { onSelect: onPartSelect, onMove: onPartMove, onDragState: onPartDragState },
      );
      sessionRef.current = session;
      return () => {
        if (sessionRef.current === session) sessionRef.current = null;
        session.dispose();
      };
    } catch (error) {
      const failed = error instanceof FieldRendererMountError ? error.cleanupSession : undefined;
      if (failed) sessionRef.current = failed;
      setRenderError(`The 3D renderer failed. ${error instanceof Error ? error.message : String(error)}`);
      return failed ? () => failed.dispose() : undefined;
    }
  }, [environment, onPartDragState, onPartMove, onPartSelect, prepared.model]);

  useEffect(() => sessionRef.current?.setHighlightedBranch(selectedAlternative), [prepared.model, selectedAlternative]);
  useEffect(() => sessionRef.current?.setSelectedPart(selectedPart), [prepared.model, selectedPart]);
  useEffect(() => sessionRef.current?.setReferenceGridVisible(gridVisible), [gridVisible, prepared.model]);
  useEffect(() => sessionRef.current?.setView(view), [prepared.model, view]);
  useEffect(() => sessionRef.current?.setTransformSpace(worldCoordinates ? "world" : "local"), [prepared.model, worldCoordinates]);
  useEffect(() => sessionRef.current?.setTranslationSnap(snapEnabled ? 10 : null), [prepared.model, snapEnabled]);

  const issue = prepared.error ?? renderError;
  return (
    <section className="field-viewer" aria-label="Drone-arm CAD viewport">
      <canvas
        ref={canvasRef}
        role="img"
        tabIndex={0}
        aria-label="Interactive 3D drone-arm assembly and verified density field"
        aria-describedby={descriptionId}
      />
      <p className="field-viewer__help" id={descriptionId}>
        Select a part · use X/Y/Z to move · drag empty space to orbit · scroll to zoom
      </p>
      <div className="cad-view-controls" role="group" aria-label="Viewport orientation">
        {(["isometric", "top", "front", "right"] as const).map((preset) => (
          <button
            type="button"
            key={preset}
            aria-label={`${preset[0]!.toUpperCase()}${preset.slice(1)} view`}
            aria-pressed={view === preset}
            onClick={() => { setView(preset); sessionRef.current?.setView(preset); }}
          >{preset === "isometric" ? "ISO" : preset[0]!.toUpperCase()}</button>
        ))}
      </div>
      <div className="cad-transform-controls" role="group" aria-label="CAD display and transforms">
        <button
          type="button"
          aria-label="Toggle reference grid"
          aria-pressed={gridVisible}
          onClick={() => setGridVisible((visible) => !visible)}
        >Grid</button>
        <button
          type="button"
          aria-label={worldCoordinates ? "World coordinates" : "Local coordinates"}
          aria-pressed={worldCoordinates}
          onClick={() => setWorldCoordinates((world) => !world)}
        >{worldCoordinates ? "World" : "Local"}</button>
        <button
          type="button"
          aria-label="Snap 10 millimetres"
          aria-pressed={snapEnabled}
          onClick={() => setSnapEnabled((enabled) => !enabled)}
        >10 mm</button>
      </div>
      <p className="field-viewer__field-status" role="status">
        {statusText ?? (current
          ? `Verified field · ${selectedRegion.label}`
          : "Assembly ready · Generate a frame to add the density field")}
      </p>
      {issue && <p className="field-viewer__message field-viewer__message--error" role="alert">{issue}</p>}
      {prepared.notice && <p className="field-viewer__message" role="status">{prepared.notice}</p>}
      {prepared.omittedCount > 0 && (
        <p className="field-viewer__message" role="status">
          {prepared.omittedCount} verified alternatives are hidden by the three-branch render limit.
        </p>
      )}
    </section>
  );
}
