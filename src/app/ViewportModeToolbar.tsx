import type { AlternativeMode } from "../viewer/alternative-instances";
import type { AssemblyPanel, WorkbenchMode } from "./workbench-mode";

export type AnalysisLayer = "density" | "loads" | "displacement" | "stress" | "safety";

interface ViewportModeToolbarProps {
  readonly mode: WorkbenchMode;
  readonly selectionLabel: string;
  readonly assemblyPanel: AssemblyPanel;
  readonly analysisLayer: AnalysisLayer;
  readonly comparisonMode: AlternativeMode;
  readonly hasCandidate: boolean;
  readonly canCompare: boolean;
  readonly primaryLabel: string;
  readonly primaryDisabled: boolean;
  readonly cancelVisible: boolean;
  readonly solverCellCount: number;
  readonly showConstraints: boolean;
  readonly topologySubject: string;
  readonly supportsFlightReplay: boolean;
  readonly onAssemblyPanelChange: (panel: AssemblyPanel) => void;
  readonly onAnalysisLayerChange: (layer: AnalysisLayer) => void;
  readonly onComparisonModeChange: (mode: AlternativeMode) => void;
  readonly onShowConstraintsChange: (shown: boolean) => void;
  readonly onPrimary: () => void;
  readonly onCancel: () => void;
}

const layerLabels: Readonly<Record<AnalysisLayer, string>> = {
  density: "Density",
  loads: "Loads",
  displacement: "Displacement",
  stress: "Stress",
  safety: "Safety",
};

function Segment<T extends string>({ label, values, selected, onChange }: {
  readonly label: string;
  readonly values: readonly { readonly id: T; readonly label: string }[];
  readonly selected: T;
  readonly onChange: (value: T) => void;
}) {
  return <div className="segmented-control" aria-label={label}>
    {values.map(({ id, label: valueLabel }) => <button
      type="button"
      key={id}
      aria-pressed={selected === id}
      onClick={() => onChange(id)}
    >{valueLabel}</button>)}
  </div>;
}

export function ViewportModeToolbar(props: ViewportModeToolbarProps) {
  const copy = props.mode === "assembly" ? { title: "Assemble", description: "Place parts and verify physical clearances." }
    : props.mode === "optimize" ? { title: "Optimize", description: `Generate a connected ${props.topologySubject} for the current assembly.` }
      : props.mode === "simulate" ? { title: "Simulate", description: props.supportsFlightReplay
        ? `Replay flight loads on the ${props.topologySubject} and attached mass.`
        : `Inspect named structural load cases on the ${props.topologySubject}.` }
        : { title: "Review", description: "Compare evidence and accept a verified candidate." };
  const layers: readonly AnalysisLayer[] = props.mode === "simulate"
    ? ["loads", "stress", "displacement"]
    : ["density", "stress", "displacement", "safety"];
  return <header className="viewport-toolbar">
    <div className="viewport-heading">
      <p className="eyebrow">Current step</p>
      <h2 id="viewport-title">{copy.title}</h2>
      <p>{copy.description}</p>
    </div>
    <div className="toolbar-controls">
      {props.mode === "assembly" && <>
        <Segment
          label="Assembly panel"
          values={[{ id: "components", label: "Parts" }, { id: "inspector", label: "Details" }]}
          selected={props.assemblyPanel}
          onChange={props.onAssemblyPanelChange}
        />
        <button
          className="toggle-button"
          type="button"
          aria-pressed={props.showConstraints}
          onClick={() => props.onShowConstraintsChange(!props.showConstraints)}
        >Safety zones</button>
      </>}
      {(props.mode === "optimize" || props.mode === "simulate") && props.hasCandidate && <Segment
        label="Result shown on frame"
        values={layers.map((layer) => ({ id: layer, label: layerLabels[layer] }))}
        selected={layers.includes(props.analysisLayer) ? props.analysisLayer : layers[0]!}
        onChange={props.onAnalysisLayerChange}
      />}
      {props.mode === "review" && props.canCompare && <Segment
        label="Candidate comparison"
        values={(["overlay", "peel", "audition"] as const).map((id) => ({
          id, label: id === "overlay" ? "Overlay" : id === "peel" ? "Peel" : "Inspect one",
        }))}
        selected={props.comparisonMode}
        onChange={props.onComparisonModeChange}
      />}
      {props.mode === "optimize" && (props.cancelVisible
        ? <button className="secondary-action" type="button" onClick={props.onCancel}>Cancel optimization</button>
        : <button className="primary-action" type="button" disabled={props.primaryDisabled} onClick={props.onPrimary}>{props.primaryLabel}</button>)}
    </div>
    {props.cancelVisible
      ? <p className="selection-context optimization-context" role="status">
          <strong>Solving {props.solverCellCount.toLocaleString()} cells</strong>
          <span>Gray center: fixed assembly interface.</span>
        </p>
      : <p className="selection-context">Selected: <strong>{props.selectionLabel}</strong></p>}
  </header>;
}
