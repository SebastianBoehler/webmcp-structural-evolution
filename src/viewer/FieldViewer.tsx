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
import { visibleInstances } from "./field-instances";
import "./field-viewer.css";

export type { FieldViewerEnvironment, ResizeEntryLike } from "./field-renderer";

export interface FieldViewerProps {
  readonly current: ViewerBranch | null;
  readonly alternatives: readonly ViewerBranch[];
  readonly selectedRegion: SelectedSemanticRegion;
  readonly threshold: number;
  readonly mode: AlternativeMode;
  readonly selectedAlternative?: string;
  readonly fieldKind?: "density" | "keep-out";
  readonly environment?: FieldViewerEnvironment;
  readonly onModeChange?: (mode: AlternativeMode) => void;
  readonly onAlternativeSelect?: (branchRevision: string) => void;
}

interface PreparedViewer {
  readonly model?: ViewerRenderModel;
  readonly comparisons: readonly AlternativeComparison[];
  readonly omittedCount: number;
  readonly error?: string;
  readonly notice?: string;
}

function resultError(branch: ViewerBranch): string {
  if (branch.result.status === "verified") return "";
  return `${branch.result.status}: ${branch.result.message}; current field not rendered.`;
}

function prepareViewer(
  current: ViewerBranch | null,
  alternatives: readonly ViewerBranch[],
  region: SelectedSemanticRegion,
  threshold: number,
  mode: AlternativeMode,
  selectedAlternative: string | undefined,
): PreparedViewer {
  if (!current) return { comparisons: [], omittedCount: 0 };
  if (current.result.status !== "verified") {
    return { comparisons: [], omittedCount: 0, error: resultError(current) };
  }
  try {
    const extraction = extractAlternativeLayers(
      current, alternatives, region, threshold, mode, selectedAlternative,
    );
    let currentInstances = visibleInstances(current.result.output, current.grid, threshold);
    let notice: string | undefined;
    if (mode === "audition") {
      const audition = extraction.layers.find(
        (layer) => layer.branchRevision === selectedAlternative,
      );
      if (audition) {
        currentInstances = audition.auditionInstances!;
      } else {
        notice = "Select a verified compatible alternative to audition; the accepted field remains visible.";
      }
    }
    return {
      model: {
        grid: current.grid,
        currentInstances,
        alternativeLayers: mode === "audition" ? [] : extraction.layers,
      },
      comparisons: extraction.comparisons,
      omittedCount: extraction.omittedCount,
      notice,
    };
  } catch (error) {
    return {
      comparisons: [],
      omittedCount: 0,
      error: `Verified field metadata is invalid; not rendered. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function regionSummary(region: SelectedSemanticRegion): string {
  return `${region.label} (${region.id}), x ${region.min[0]}–${region.maxExclusive[0]}, y ${region.min[1]}–${region.maxExclusive[1]}, z ${region.min[2]}–${region.maxExclusive[2]}`;
}

function statusText(comparison: AlternativeComparison): string {
  if (comparison.status === "renderable") return "Renderable: verified local delta";
  return `${comparison.status}: ${comparison.reason}`;
}

export function FieldViewer({
  current,
  alternatives,
  selectedRegion,
  threshold,
  mode,
  selectedAlternative,
  fieldKind = "density",
  environment,
  onModeChange,
  onAlternativeSelect,
}: FieldViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<FieldRendererSession | null>(null);
  const summaryId = useId();
  const [highlightedBranch, setHighlightedBranch] = useState<string | undefined>(selectedAlternative);
  const [renderError, setRenderError] = useState<string>();
  const auditionSelection = mode === "audition" ? selectedAlternative : undefined;
  const prepared = useMemo(
    () => prepareViewer(
      current,
      alternatives,
      selectedRegion,
      threshold,
      mode,
      auditionSelection,
    ),
    [current, alternatives, selectedRegion, threshold, mode, auditionSelection],
  );

  useEffect(() => setHighlightedBranch(selectedAlternative), [selectedAlternative]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !prepared.model) return;
    setRenderError(undefined);
    try {
      const session = mountFieldRenderer(canvas, prepared.model, viewerEnvironment(environment));
      sessionRef.current = session;
      return () => {
        if (sessionRef.current === session) sessionRef.current = null;
        session.dispose();
      };
    } catch (error) {
      const failedSession = error instanceof FieldRendererMountError
        ? error.cleanupSession
        : undefined;
      if (failedSession) sessionRef.current = failedSession;
      setRenderError(`3D renderer failed: ${error instanceof Error ? error.message : String(error)}`);
      if (failedSession) {
        return () => {
          if (sessionRef.current === failedSession) sessionRef.current = null;
          failedSession.dispose();
        };
      }
    }
  }, [environment, prepared.model]);

  useEffect(() => {
    sessionRef.current?.setHighlightedBranch(highlightedBranch);
  }, [highlightedBranch]);

  const leaveAlternative = () => setHighlightedBranch(selectedAlternative);
  return (
    <section className="field-viewer" aria-labelledby={summaryId}>
      <div className="field-viewer__viewport">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="3D voxel field comparison"
          aria-describedby={summaryId}
        />
        {!current && <p className="field-viewer__message" role="status">Waiting for verified compute output.</p>}
        {(prepared.error || renderError) && (
          <p className="field-viewer__message field-viewer__message--error" role="alert">
            {prepared.error ?? renderError}
          </p>
        )}
        {prepared.notice && <p className="field-viewer__message" role="status">{prepared.notice}</p>}
      </div>

      <div className="field-viewer__details">
        <p className="field-viewer__eyebrow">Verified {fieldKind} field</p>
        <h2 id={summaryId}>Selected region: {regionSummary(selectedRegion)}</h2>
        <fieldset>
          <legend>Comparison mode</legend>
          <div className="field-viewer__modes">
            {(["overlay", "peel", "audition"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`${summaryId}-mode`}
                  value={value}
                  checked={mode === value}
                  onChange={() => onModeChange?.(value)}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>

        {prepared.omittedCount > 0 && (
          <p role="status">{prepared.omittedCount} verified alternatives are listed but not rendered by the three-branch limit.</p>
        )}
        <div className="field-viewer__table-wrap">
          <table>
            <caption>Verified branch comparison for {selectedRegion.label}</caption>
            <thead>
              <tr><th>Branch</th><th>Context</th><th>Parent</th><th>Delta</th><th>Status</th><th>Inspect</th></tr>
            </thead>
            <tbody>
              {current && (
                <tr>
                  <td>{current.branchRevision}</td><td>{current.contextRevision}</td><td>{current.parentRevision}</td>
                  <td>Accepted source</td><td>{current.result.status}</td><td>Current</td>
                </tr>
              )}
              {prepared.comparisons.map((comparison) => {
                const branchLabel = comparison.branchRevision.trim() || "Missing branch ID";
                return (
                  <tr key={comparison.sourceIndex} data-highlighted={highlightedBranch === comparison.branchRevision}>
                    <td>{branchLabel}</td>
                    <td>{comparison.contextRevision}</td>
                    <td>{comparison.parentRevision}</td>
                    <td>{comparison.addedCount} added, {comparison.removedCount} removed</td>
                    <td>{statusText(comparison)}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Select ${branchLabel}`}
                        disabled={comparison.status !== "renderable"}
                        onClick={() => onAlternativeSelect?.(comparison.branchRevision)}
                        onFocus={() => setHighlightedBranch(comparison.branchRevision)}
                        onBlur={leaveAlternative}
                        onMouseEnter={() => setHighlightedBranch(comparison.branchRevision)}
                        onMouseLeave={leaveAlternative}
                      >Inspect</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
