import { useCallback, useMemo, useState } from "react";

import { useAssemblyWorkspace } from "../assembly/use-assembly-workspace";
import { compileLiveTopologyContext } from "../optimization/assembly-topology-input";
import type { GpuCapability } from "../gpu/capabilities";
import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import {
  DRONE_ARM_FOUNDATION_CONTEXT,
  DRONE_ARM_FOUNDATION_STUDY,
  FOUNDATION_SELECTIONS,
} from "../samples/drone-arm-foundation";
import { FieldViewer, type FieldViewerEnvironment } from "../viewer/FieldViewer";
import type { AlternativeMode } from "../viewer/alternative-instances";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import type { ProbeComparisonFacts, ProbeVariant } from "../webmcp/schemas";
import { FlightSimulationPanel } from "../simulation/FlightSimulationPanel";
import { createFlightFrameChannel } from "../simulation/flight-frame-channel";
import { ComponentBrowser } from "./ComponentBrowser";
import { AlternativeSelector } from "./AlternativeSelector";
import { EvidencePanel } from "./EvidencePanel";
import { ExperimentRail } from "./ExperimentRail";
import { InspectorPanel } from "./InspectorPanel";
import { ImportReview } from "./ImportReview";
import { ReceiptLedger } from "./ReceiptLedger";
import { TopologyResultPanel } from "./TopologyResultPanel";
import { useProjectState } from "./useProjectState";
import { useTheme } from "./useTheme";
import { WorkbenchDrawer, type DrawerView } from "./WorkbenchDrawer";
import { WorkbenchHeader } from "./WorkbenchHeader";
import { WorkbenchAgentTools } from "./WorkbenchAgentTools";
import { foundationView } from "./foundation-view";
import { buildProbeInput } from "./project-probe";

const fixture = DRONE_ARM_FOUNDATION_STUDY;
const initialContext = DRONE_ARM_FOUNDATION_CONTEXT;
const initialAcceptedRevision = fixture.assembly.revision;
const probeCopy: Record<ProbeVariant, { hypothesis: string; prediction: string }> = {
  balanced: {
    hypothesis: "Balance a spatial truss across hover agility and torsion loads",
    prediction: "Retain 26 percent material plus every must-pass path and keep-out",
  },
  "lightweight": {
    hypothesis: "Reduce frame mass while preserving continuous motor-to-core load paths",
    prediction: "Material should fall to 20 percent with higher but finite compliance",
  },
  "stiffness": {
    hypothesis: "Prioritize stiffness for aggressive roll pitch and torsion load cases",
    prediction: "Compliance and displacement should improve using a 34 percent material budget",
  },
};

export interface FoundationJourneyProps {
  readonly capability: GpuCapability;
  readonly compute?: (input: ProbeInput, signal?: AbortSignal) => Promise<ProbeResult>;
  readonly viewerEnvironment?: FieldViewerEnvironment;
}
export function FoundationJourney({ capability, compute, viewerEnvironment }: FoundationJourneyProps) {
  const workspace = useAssemblyWorkspace();
  const liveTopology = useMemo(
    () => compileLiveTopologyContext(workspace),
    [workspace.revision],
  );
  const { state, services, experimentRail } = useProjectState({
    contextRevision: workspace.revision,
    context: initialContext,
    acceptedBranchRevision: initialAcceptedRevision,
    selection: initialContext.selection,
    locks: initialContext.locks,
    capability,
    compute,
    buildProbeInput: (variant) => buildProbeInput(variant, liveTopology),
  });
  const { theme, setTheme } = useTheme();
  const activityReceipts = [...state.receipts, ...workspace.receipts].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const [mode, setMode] = useState<AlternativeMode>("overlay");
  const [analysisLayer, setAnalysisLayer] = useState<"density" | "loads" | "displacement" | "stress" | "safety">("density");
  const [selectedAlternative, setSelectedAlternative] = useState<string>();
  const [selectedPart, setSelectedPart] = useState("arm-design-region");
  const [showConstraints, setShowConstraints] = useState(false);
  const [showComponents, setShowComponents] = useState(true);
  const [simulationActive, setSimulationActive] = useState(false);
  const flightFrameChannel = useMemo(createFlightFrameChannel, []);
  const [droneOnly, setDroneOnly] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<DrawerView>();
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [componentsCollapsed, setComponentsCollapsed] = useState(false);
  const [analysisDockOpen, setAnalysisDockOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [comparison, setComparison] = useState<ProbeComparisonFacts>();
  const [error, setError] = useState<string>();

  const { accepted, preview, alternatives, viewerCurrent, viewerAlternatives, currentVerified, currentBranches } = foundationView(state);
  const latestVariant = (variant: ProbeVariant) => [...currentBranches].reverse().find(
    (branch) => branch.variant === variant,
  );
  const canRetry = (variant: ProbeVariant) => {
    const status = latestVariant(variant)?.status;
    return !status || status === "failed" || status === "mismatch" || status === "canceled";
  };
  const balanced = latestVariant("balanced");
  const balancedTopology = balanced?.result?.status === "verified" ? balanced.result.topology : undefined;
  const balancedFailsMaterialScreen = balancedTopology !== undefined
    && balancedTopology.minimumSafetyFactor < 1;
  const nextVariant = !accepted
    ? canRetry("balanced") ? "balanced"
      : balancedFailsMaterialScreen && canRetry("stiffness") ? "stiffness"
        : undefined
    : canRetry("lightweight") ? "lightweight"
      : latestVariant("lightweight")?.status === "verified" && canRetry("stiffness")
        ? "stiffness" : undefined;
  const pendingPromotion = currentBranches.find(
    (branch) => branch.status === "verified" && branch.branchRevision !== state.acceptedBranchRevision,
  );
  const readyToCompare = accepted && currentVerified.length >= 2;
  const retrying = nextVariant !== undefined && latestVariant(nextVariant) !== undefined;
  const primaryLabel = workspace.layoutState !== "verified" ? "Topology context needs rebuild"
    : state.operationStatus === "running" ? "Optimizing frame…"
    : state.operationStatus === "canceling" ? "Canceling…"
      : nextVariant === "balanced" ? `${retrying ? "Retry" : "Generate"} balanced frame`
        : nextVariant === "lightweight" ? `${retrying ? "Retry" : "Generate"} lightweight frame`
          : nextVariant === "stiffness" ? `${retrying ? "Retry" : "Generate"} stiffness-first frame`
            : readyToCompare ? "Compare alternatives"
              : pendingPromotion ? "Review topology candidate" : "No action available";

  const runVariant = async (variant: ProbeVariant) => {
    setError(undefined);
    try {
      await services.runProbe({ parentRevision: state.contextRevision, variant, ...probeCopy[variant] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const compare = async () => {
    setError(undefined);
    try {
      const [left, right] = currentVerified;
      if (!left || !right) throw new Error("Generate two verified alternatives before comparing them.");
      setComparison(await services.compareProbes({
        leftRevision: left.branchRevision,
        rightRevision: right.branchRevision,
      }));
      setActiveDrawer("evidence");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const runPrimary = () => {
    if (nextVariant) void runVariant(nextVariant);
    else if (readyToCompare) void compare();
    else if (pendingPromotion) setActiveDrawer("branches");
  };
  const cancel = async () => {
    setError(undefined);
    try { await services.cancelProbe(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const intervene = async () => {
    setError(undefined);
    try {
      await experimentRail.intervene({
        selection: FOUNDATION_SELECTIONS["cable-clearance"]!,
        locks: [...state.context.locks, "cable-clearance"],
      });
      setComparison(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const visibleParts = useMemo(() => {
    const parts = workspace.parts.filter((part) =>
      (showConstraints || part.appearance !== "constraint")
      && (showComponents || part.appearance !== "component")
      && (viewerCurrent === null || part.appearance !== "design-region"));
    if (!viewerCurrent || (analysisLayer !== "loads" && !simulationActive)) return parts;
    const loadVectors: readonly AssemblyVisualPart[] = workspace.motors.map((motor) => ({
      id: `${motor.id}-load-vector`, selectionId: motor.id, label: `${motor.label} 18 N thrust load`,
      appearance: "generated", kind: "load-vector", center: motor.anchor,
      forceN: [0, 0, -18], length: 28,
    }));
    return [...parts, ...loadVectors];
  }, [analysisLayer, showComponents, showConstraints, simulationActive, viewerCurrent, workspace.motors, workspace.parts]);
  const flightMotors = useMemo(() => workspace.motors.map((motor, index) => ({
    id: motor.id,
    centerM: liveTopology.input.motorMounts[index]!.centerM,
  })), [liveTopology, workspace.motors]);
  const handleFlightFrame = useCallback((frame: Parameters<typeof flightFrameChannel.emit>[0]) => flightFrameChannel.emit(frame), [flightFrameChannel]);
  const handlePartMove = useCallback((id: string, center: readonly [number, number, number]) => {
    workspace.movePart(id, center);
  }, [workspace.movePart]);
  const handlePartDragState = useCallback((dragging: boolean) => {
    workspace.setLayoutState(dragging ? "dragging" : "changed");
  }, [workspace.setLayoutState]);
  const drawerItems = [
    {
      id: "evidence" as const,
      label: "Evidence",
      content: <EvidencePanel state={state} comparison={comparison} initialAcceptedRevision={initialAcceptedRevision} />,
    },
    {
      id: "branches" as const,
      label: "Branches",
      count: state.stagedBranches.length,
      content: <ExperimentRail state={state} api={experimentRail} />,
    },
    {
      id: "history" as const,
      label: "History",
      count: activityReceipts.length,
      content: <ReceiptLedger receipts={activityReceipts} />,
    },
    {
      id: "agents" as const,
      label: "Agent tools",
      content: <WorkbenchAgentTools
        state={state}
        services={services}
        imports={workspace.imports}
        pending={workspace.pending}
        parts={workspace.parts}
        layoutVersion={workspace.layoutVersion}
        onStage={workspace.stageImport}
        onMove={workspace.movePart}
      />,
    },
  ];

  return (
    <main className="workbench-shell">
      <WorkbenchHeader
        capability={capability}
        theme={theme}
        primaryLabel={primaryLabel}
        primaryDisabled={
          capability.status !== "available"
          || state.operationStatus !== "idle"
          || workspace.layoutState !== "verified"
          || (!nextVariant && !readyToCompare && !pendingPromotion)
        }
        cancelVisible={state.operationStatus === "running"}
        onPrimary={runPrimary}
        onCancel={() => void cancel()}
        onThemeChange={setTheme}
        onOpenComponents={() => {
          setComponentsCollapsed(false);
          setComponentsOpen(true);
        }}
        onOpenInspector={() => setInspectorOpen(true)}
      />
      {error && <p className="global-error" role="alert">{error}</p>}
      <div className="workbench-stage" data-components-collapsed={componentsCollapsed}>
        <ComponentBrowser
          selectedId={selectedPart} open={componentsOpen} parts={workspace.parts}
          revision={workspace.revision} conflictCount={workspace.conflicts.length}
          onSelect={(id) => { setSelectedPart(id); setComponentsOpen(false); }}
          onImportFile={async (file) => {
            try { setSelectedPart(await workspace.importFile(file)); }
            catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          }}
          onReplaceDisplayFile={async (id, file) => {
            try { setSelectedPart(await workspace.replaceDisplayFile(id, file)); }
            catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          }}
          onClose={() => {
            setComponentsOpen(false);
            setComponentsCollapsed(true);
          }}
        />
        <section className="viewport-workspace" aria-labelledby="viewport-title">
          <header className="viewport-toolbar">
            <div><h2 id="viewport-title">Assembly viewport</h2><p>{state.context.selection.label}</p></div>
            <div className="toolbar-controls">
              <button
                className="toggle-button"
                type="button"
                aria-expanded={!componentsCollapsed}
                onClick={() => setComponentsCollapsed((collapsed) => !collapsed)}
              >{componentsCollapsed ? "Show assembly" : "Hide assembly"}</button>
              <button
                className="toggle-button"
                type="button"
                aria-expanded={analysisDockOpen}
                onClick={() => setAnalysisDockOpen((open) => !open)}
              >Analysis</button>
              <div className="segmented-control" aria-label="Structural result layer">
                {(["density", "loads", "displacement", "stress", "safety"] as const).map((layer) => (
                  <button type="button" key={layer} aria-pressed={analysisLayer === layer} onClick={() => setAnalysisLayer(layer)}>
                    {layer}
                  </button>
                ))}
              </div>
              <div className="segmented-control" aria-label="Comparison mode">
                {(["overlay", "peel", "audition"] as const).map((value) => (
                  <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
                    {value}
                  </button>
                ))}
              </div>
              <button
                className="toggle-button"
                type="button"
                aria-pressed={showComponents}
                onClick={() => setShowComponents((shown) => !shown)}
              >Components</button>
              <button
                className="toggle-button"
                type="button"
                aria-pressed={showConstraints}
                onClick={() => setShowConstraints((shown) => !shown)}
              >Constraints</button>
            </div>
          </header>
          <div className="viewport-canvas" data-analysis-open={analysisDockOpen}>
            <div className="viewport-scene">
              <FieldViewer
              current={workspace.layoutState === "verified" ? viewerCurrent : null}
              alternatives={viewerAlternatives}
              selectedRegion={state.context.selection}
              threshold={0.5}
              mode={mode}
              grid={viewerCurrent?.grid ?? state.context.grid}
              assemblyParts={visibleParts}
              selectedAlternative={selectedAlternative}
              selectedPart={selectedPart}
              analysisLayer={analysisLayer}
              statusText={viewerCurrent
                ? workspace.layoutState === "dragging"
                  ? "Moving component · rotor safety geometry follows"
                  : workspace.layoutState === "changed"
                    ? "Layout changed · previous topology evidence is stale"
                    : pendingPromotion ? "Candidate topology · verified and awaiting human acceptance" : undefined
                : pendingPromotion
                  ? "Verified branch ready for human review"
                  : undefined}
              flightFrameSource={flightFrameChannel}
              droneOnly={droneOnly}
              environment={viewerEnvironment}
              onPartSelect={setSelectedPart}
              onPartMove={handlePartMove}
              onPartDragState={handlePartDragState}
              />
              {workspace.pending && (
                <ImportReview
                  pending={workspace.pending}
                  onApprove={async () => {
                    setSelectedPart(workspace.pending!.id);
                    await workspace.approveImport();
                  }}
                  onReject={workspace.rejectImport}
                />
              )}
              {viewerCurrent && <AlternativeSelector
                alternatives={alternatives}
                selected={selectedAlternative}
                onSelect={setSelectedAlternative}
              />}
            </div>
            <aside className="analysis-dock" aria-label="Analysis dock">
              <FlightSimulationPanel
                motors={viewerCurrent ? flightMotors : []}
                massKg={liveTopology.input.assemblyMassKg}
                onFrame={handleFlightFrame}
                onActiveChange={(active) => {
                  setSimulationActive(active);
                  if (active) {
                    setAnalysisLayer("stress");
                    setShowConstraints(false);
                  }
                }}
                onDroneOnlyChange={setDroneOnly}
              />
              {viewerCurrent && <TopologyResultPanel branch={viewerCurrent} variant={preview?.variant} assemblyParts={workspace.parts} />}
            </aside>
          </div>
          <WorkbenchDrawer active={activeDrawer} items={drawerItems} onChange={setActiveDrawer} />
        </section>
        <InspectorPanel
          selectedId={selectedPart} context={state.context}
          topologyGrid={viewerCurrent?.grid ?? liveTopology.grid}
          parts={workspace.parts} imports={workspace.imports}
          assembly={workspace.draft} catalog={workspace.catalog} conflicts={workspace.conflicts}
          layoutState={workspace.layoutState}
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          onLockCableClearance={() => void intervene()}
          onMovePart={workspace.movePart}
        />
      </div>
    </main>
  );
}
