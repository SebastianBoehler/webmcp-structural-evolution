import { useCallback, useEffect, useMemo, useState } from "react";

import { useAssemblyWorkspace } from "../assembly/use-assembly-workspace";
import { runTopologyProbeInWorker } from "../optimization/topology-probe-client";
import { DEMO_FIXTURES } from "../samples/demo-fixtures";
import { FOUNDATION_SELECTIONS } from "../samples/drone-arm-foundation";
import { FieldViewer } from "../viewer/FieldViewer";
import type { AlternativeMode } from "../viewer/alternative-instances";
import type { ProbeComparisonFacts, ProbeVariant } from "../webmcp/schemas";
import { createFlightFrameChannel } from "../simulation/flight-frame-channel";
import { ComponentBrowser } from "./ComponentBrowser";
import { AlternativeSelector } from "./AlternativeSelector";
import { InspectorPanel } from "./InspectorPanel";
import { ImportReview } from "./ImportReview";
import { TopologyResultPanel } from "./TopologyResultPanel";
import { useProjectState } from "./useProjectState";
import { useTheme } from "./useTheme";
import type { DrawerView } from "./WorkbenchDrawer";
import { WorkbenchHeader } from "./WorkbenchHeader";
import { WorkbenchReviewDock } from "./WorkbenchReviewDock";
import { ViewportModeToolbar, type AnalysisLayer } from "./ViewportModeToolbar";
import { foundationView } from "./foundation-view";
import { FixtureSimulationDock } from "./FixtureSimulationDock";
import { fixtureViewerStatus } from "./fixture-viewer-status";
import type { FoundationJourneyProps } from "./foundation-journey-types";
import { deriveOptimizationNavigation } from "./optimization-navigation";
import { buildProbeInput } from "./project-probe";
import { probeCopy } from "./probe-copy";
import { useVisibleAssemblyParts } from "./use-visible-assembly-parts";
import type { AssemblyPanel, WorkbenchMode } from "./workbench-mode";
export function FoundationJourney({
  capability,
  compute,
  viewerEnvironment,
  fixtureId = "reference-drone",
  onFixtureChange = () => undefined,
}: FoundationJourneyProps) {
  const fixture = DEMO_FIXTURES[fixtureId];
  const initialContext = fixture.context;
  const initialAcceptedRevision = fixture.acceptedRevision;
  const workspace = useAssemblyWorkspace(fixtureId === "reference-drone"
    ? undefined
    : { initialState: fixture.initialState, inventory: fixture.inventory });
  const liveTopology = useMemo(
    () => fixture.compileTopology(workspace),
    [fixture, workspace.revision],
  );
  const { state, services, experimentRail } = useProjectState({
    contextRevision: workspace.revision,
    context: initialContext,
    acceptedBranchRevision: initialAcceptedRevision,
    selection: initialContext.selection,
    locks: initialContext.locks,
    capability,
    compute: compute ?? runTopologyProbeInWorker,
    buildProbeInput: (variant) => buildProbeInput(variant, liveTopology),
  });
  const { theme, setTheme } = useTheme();
  const [workspaceMode, setWorkspaceMode] = useState<WorkbenchMode>("assembly");
  const [assemblyPanel, setAssemblyPanel] = useState<AssemblyPanel>("components");
  const [comparisonMode, setComparisonMode] = useState<AlternativeMode>("overlay");
  const [analysisLayer, setAnalysisLayer] = useState<AnalysisLayer>("density");
  const [selectedAlternative, setSelectedAlternative] = useState<string>();
  const [selectedPart, setSelectedPart] = useState(
    fixtureId === "reference-drone"
      ? "arm-design-region"
      : fixture.initialState.draft.components[0]?.instanceId ?? initialContext.selection.id,
  );
  const [showConstraints, setShowConstraints] = useState(false);
  const [showComponents, setShowComponents] = useState(true);
  const [simulationActive, setSimulationActive] = useState(false);
  const flightFrameChannel = useMemo(createFlightFrameChannel, []);
  const [activeDrawer, setActiveDrawer] = useState<DrawerView>("evidence");
  const [comparison, setComparison] = useState<ProbeComparisonFacts>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (state.operationStatus === "running") setWorkspaceMode("optimize");
  }, [state.operationStatus]);

  const { accepted, preview, alternatives, viewerCurrent, viewerAlternatives, currentVerified, currentBranches } = foundationView(state);
  const { nextVariant, pendingPromotion, readyToCompare, primaryLabel, primaryDisabled } = deriveOptimizationNavigation(
    state, currentBranches, accepted !== undefined, currentVerified.length, workspace.layoutState === "verified",
    fixture.topologySubject,
  );

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
      setWorkspaceMode("review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const runPrimary = () => {
    if (nextVariant) void runVariant(nextVariant);
    else if (readyToCompare) void compare();
    else if (pendingPromotion) {
      setActiveDrawer("branches");
      setWorkspaceMode("review");
    }
  };

  const changeWorkspaceMode = (next: WorkbenchMode) => {
    setWorkspaceMode(next);
    if (next === "assembly") setAssemblyPanel("components");
    if (next === "simulate") {
      setAnalysisLayer("stress");
      setShowConstraints(false);
    }
    if (next === "review") setActiveDrawer(pendingPromotion ? "branches" : "evidence");
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
        selection: fixtureId === "reference-drone"
          ? FOUNDATION_SELECTIONS["cable-clearance"]!
          : initialContext.selection,
        locks: [...state.context.locks, fixtureId === "reference-drone" ? "cable-clearance" : initialContext.selection.id],
      });
      setComparison(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const visibleParts = useVisibleAssemblyParts(workspace.parts, workspace.motors, {
    mode: workspaceMode, analysisLayer, showComponents, showConstraints,
    simulationActive, hasTopology: viewerCurrent !== null,
  });
  const flightMotors = useMemo(() => workspace.motors.flatMap((motor, index) => {
    const mount = liveTopology.input.motorMounts[index];
    return mount ? [{ id: motor.id, centerM: mount.centerM }] : [];
  }), [liveTopology, workspace.motors]);
  const handleFlightFrame = useCallback((frame: Parameters<typeof flightFrameChannel.emit>[0]) => flightFrameChannel.emit(frame), [flightFrameChannel]);
  const handlePartMove = useCallback((id: string, center: readonly [number, number, number]) => {
    workspace.movePart(id, center);
  }, [workspace.movePart]);
  const handlePartDragState = useCallback((dragging: boolean) => {
    workspace.setLayoutState(dragging ? "dragging" : "changed");
  }, [workspace.setLayoutState]);
  const dockOpen = workspaceMode === "simulate"
    || workspaceMode === "review"
    || (workspaceMode === "optimize" && viewerCurrent !== null);

  return (
    <main className="workbench-shell">
      <WorkbenchHeader
        capability={capability}
        theme={theme}
        mode={workspaceMode}
        fixtureId={fixtureId}
        onModeChange={changeWorkspaceMode}
        onFixtureChange={onFixtureChange}
        onThemeChange={setTheme}
      />
      {error && <p className="global-error" role="alert">{error}</p>}
      <div className="workbench-stage" data-panel={workspaceMode === "assembly" ? assemblyPanel : "none"}>
        <ComponentBrowser
          selectedId={selectedPart} open={workspaceMode === "assembly" && assemblyPanel === "components"} parts={workspace.parts}
          revision={workspace.revision} conflictCount={workspace.conflicts.length}
          onSelect={(id) => { setSelectedPart(id); setAssemblyPanel("inspector"); }}
          onImportFile={async (file) => {
            try { setSelectedPart(await workspace.importFile(file)); }
            catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          }}
          onReplaceDisplayFile={async (id, file) => {
            try { setSelectedPart(await workspace.replaceDisplayFile(id, file)); }
            catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          }}
          onClose={() => setAssemblyPanel("inspector")}
        />
        <section className="viewport-workspace" aria-labelledby="viewport-title">
          <ViewportModeToolbar
            mode={workspaceMode}
            selectionLabel={state.context.selection.label}
            assemblyPanel={assemblyPanel}
            analysisLayer={analysisLayer}
            comparisonMode={comparisonMode}
            hasCandidate={viewerCurrent !== null}
            canCompare={alternatives.length > 1}
            primaryLabel={primaryLabel}
            primaryDisabled={primaryDisabled}
            cancelVisible={state.operationStatus === "running"}
            solverCellCount={liveTopology.grid.dimensions.width * liveTopology.grid.dimensions.height * liveTopology.grid.dimensions.depth}
            showConstraints={showConstraints}
            topologySubject={fixture.topologySubject}
            supportsFlightReplay={fixture.supportsFlightReplay}
            onAssemblyPanelChange={setAssemblyPanel}
            onAnalysisLayerChange={setAnalysisLayer}
            onComparisonModeChange={setComparisonMode}
            onShowConstraintsChange={setShowConstraints}
            onPrimary={runPrimary}
            onCancel={() => void cancel()}
          />
          <div className="viewport-canvas" data-dock-open={dockOpen}>
            <div className="viewport-scene">
              <FieldViewer
              current={workspaceMode !== "assembly" && workspace.layoutState === "verified" ? viewerCurrent : null}
              alternatives={viewerAlternatives}
              selectedRegion={state.context.selection}
              threshold={0.5}
              mode={workspaceMode === "review" ? comparisonMode : "overlay"}
              grid={viewerCurrent?.grid ?? state.context.grid}
              assemblyParts={visibleParts}
              selectedAlternative={selectedAlternative}
              selectedPart={selectedPart}
              analysisLayer={analysisLayer}
              statusText={fixtureViewerStatus({ hasTopology: viewerCurrent !== null, layoutState: workspace.layoutState,
                pendingPromotion: pendingPromotion !== undefined, supportsFlightReplay: fixture.supportsFlightReplay })}
              flightFrameSource={flightFrameChannel}
              environment={viewerEnvironment}
              onPartSelect={(id) => {
                setSelectedPart(id);
                if (workspaceMode === "assembly") setAssemblyPanel("inspector");
              }}
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
              {workspaceMode === "review" && viewerCurrent && <AlternativeSelector
                alternatives={alternatives}
                selected={selectedAlternative}
                onSelect={setSelectedAlternative}
              />}
            </div>
            {workspaceMode === "optimize" && viewerCurrent && <aside className="analysis-dock" aria-label="Optimization results">
              <TopologyResultPanel
                branch={viewerCurrent} variant={preview?.variant} assemblyParts={workspace.parts}
                assemblyId={fixture.id} topologySubject={fixture.topologySubject} materialLabel={fixture.materialLabel}
                loadCaseIds={liveTopology.input.loadCases.map(({ id }) => id)}
              />
            </aside>}
            {workspaceMode === "simulate" && <FixtureSimulationDock
                supportsFlightReplay={fixture.supportsFlightReplay}
                topology={liveTopology.input}
                motors={viewerCurrent ? flightMotors : []}
                onFrame={handleFlightFrame}
                onActiveChange={(active) => {
                  setSimulationActive(active);
                  if (active) {
                    setAnalysisLayer("stress");
                    setShowConstraints(false);
                  }
                }}
                componentsVisible={showComponents}
                onComponentsVisibleChange={setShowComponents}
            />}
            <aside className="review-dock" aria-label="Review evidence" hidden={workspaceMode !== "review"}>
              <WorkbenchReviewDock
                active={activeDrawer}
                state={state}
                services={services}
                experimentRail={experimentRail}
                comparison={comparison}
                initialAcceptedRevision={initialAcceptedRevision}
                workspaceReceipts={workspace.receipts}
                imports={workspace.imports}
                pending={workspace.pending}
                parts={workspace.parts}
                layoutVersion={workspace.layoutVersion}
                fixtureId={fixtureId}
                onGenerateFixture={onFixtureChange}
                onStage={workspace.stageImport}
                onMove={workspace.movePart}
                onChange={setActiveDrawer}
              />
            </aside>
          </div>
        </section>
        <InspectorPanel
          selectedId={selectedPart} context={state.context}
          topologyGrid={viewerCurrent?.grid ?? liveTopology.grid}
          parts={workspace.parts} imports={workspace.imports}
          assembly={workspace.draft} catalog={workspace.catalog} conflicts={workspace.conflicts}
          layoutState={workspace.layoutState}
          open={workspaceMode === "assembly" && assemblyPanel === "inspector"}
          onClose={() => setAssemblyPanel("components")}
          onLockCableClearance={() => void intervene()}
          onMovePart={workspace.movePart}
        />
      </div>
    </main>
  );
}
