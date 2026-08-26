import { useMemo, useState } from "react";

import type { GpuCapability } from "../gpu/capabilities";
import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import {
  DRONE_ARM_FOUNDATION_CONTEXT,
  DRONE_ARM_FOUNDATION_STUDY,
  FOUNDATION_SELECTIONS,
} from "../samples/drone-arm-foundation";
import { FieldViewer, type FieldViewerEnvironment } from "../viewer/FieldViewer";
import type { AlternativeMode, ViewerBranch } from "../viewer/alternative-instances";
import { FoundationTools } from "../webmcp/FoundationTools";
import type { ProbeComparisonFacts, ProbeVariant } from "../webmcp/schemas";
import { ComponentBrowser } from "./ComponentBrowser";
import { DRONE_ARM_VISUALS } from "./drone-arm-visuals";
import { EvidencePanel } from "./EvidencePanel";
import { ExperimentRail } from "./ExperimentRail";
import { InspectorPanel } from "./InspectorPanel";
import { ReceiptLedger } from "./ReceiptLedger";
import { useProjectState } from "./useProjectState";
import { useTheme } from "./useTheme";
import { WorkbenchDrawer, type DrawerView } from "./WorkbenchDrawer";
import { WorkbenchHeader } from "./WorkbenchHeader";

const fixture = DRONE_ARM_FOUNDATION_STUDY;
const initialContext = DRONE_ARM_FOUNDATION_CONTEXT;
const initialAcceptedRevision = fixture.assembly.revision;

const probeCopy: Record<ProbeVariant, { hypothesis: string; prediction: string }> = {
  baseline: {
    hypothesis: "Establish the deterministic reference field",
    prediction: "Verification should pass with zero L2 mismatch",
  },
  "edge-biased": {
    hypothesis: "Exercise the edge-biased input distribution",
    prediction: "Verification should pass within the timing budget",
  },
  "center-biased": {
    hypothesis: "Exercise the center-biased input distribution",
    prediction: "Verification should pass within the timing budget",
  },
};

export interface FoundationJourneyProps {
  readonly capability: GpuCapability;
  readonly compute?: (input: ProbeInput, signal?: AbortSignal) => Promise<ProbeResult>;
  readonly viewerEnvironment?: FieldViewerEnvironment;
}

export function FoundationJourney({ capability, compute, viewerEnvironment }: FoundationJourneyProps) {
  const { state, services, experimentRail } = useProjectState({
    contextRevision: fixture.study.revision,
    context: initialContext,
    acceptedBranchRevision: initialAcceptedRevision,
    selection: initialContext.selection,
    locks: initialContext.locks,
    capability,
    compute,
  });
  const { theme, setTheme } = useTheme();
  const [mode, setMode] = useState<AlternativeMode>("overlay");
  const [selectedAlternative, setSelectedAlternative] = useState<string>();
  const [selectedPart, setSelectedPart] = useState("arm-design-region");
  const [showConstraints, setShowConstraints] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<DrawerView>();
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [comparison, setComparison] = useState<ProbeComparisonFacts>();
  const [error, setError] = useState<string>();

  const accepted = state.stagedBranches.find(
    (branch) => branch.branchRevision === state.acceptedBranchRevision && branch.result?.status === "verified",
  );
  const alternatives = state.stagedBranches.filter(
    (branch) => branch.branchRevision !== state.acceptedBranchRevision && branch.result?.status === "verified",
  );
  const viewerCurrent: ViewerBranch | null = accepted?.result?.status === "verified" ? {
    branchRevision: accepted.branchRevision,
    contextRevision: state.contextRevision,
    parentRevision: accepted.parentRevision,
    grid: state.context.grid,
    result: accepted.result,
  } : null;
  const viewerAlternatives: readonly ViewerBranch[] = alternatives.map((branch) => ({
    branchRevision: branch.branchRevision,
    contextRevision: branch.parentRevision,
    parentRevision: branch.parentRevision,
    grid: state.context.grid,
    result: branch.result!,
  }));
  const currentVerified = alternatives.filter(
    (branch) => branch.parentRevision === state.contextRevision && !branch.stale && branch.status === "verified",
  );
  const currentBranches = state.stagedBranches.filter(
    (branch) => branch.parentRevision === state.contextRevision && !branch.stale,
  );
  const latestVariant = (variant: ProbeVariant) => [...currentBranches].reverse().find(
    (branch) => branch.variant === variant,
  );
  const canRetry = (variant: ProbeVariant) => {
    const status = latestVariant(variant)?.status;
    return !status || status === "failed" || status === "mismatch" || status === "canceled";
  };
  const nextVariant = !accepted
    ? canRetry("baseline") ? "baseline" : undefined
    : canRetry("edge-biased") ? "edge-biased"
      : latestVariant("edge-biased")?.status === "verified" && canRetry("center-biased")
        ? "center-biased" : undefined;
  const pendingPromotion = currentBranches.find(
    (branch) => branch.status === "verified" && branch.branchRevision !== state.acceptedBranchRevision,
  );
  const readyToCompare = accepted && currentVerified.length >= 2;
  const retrying = nextVariant !== undefined && latestVariant(nextVariant) !== undefined;
  const primaryLabel = state.operationStatus === "running" ? "Verification running…"
    : state.operationStatus === "canceling" ? "Canceling…"
      : nextVariant === "baseline" ? `${retrying ? "Retry" : "Run"} baseline verification`
        : nextVariant === "edge-biased" ? `${retrying ? "Retry" : "Generate"} edge alternative`
          : nextVariant === "center-biased" ? `${retrying ? "Retry" : "Generate"} center alternative`
            : readyToCompare ? "Compare alternatives"
              : pendingPromotion ? "Review verified branch" : "No action available";

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
  const visibleParts = useMemo(
    () => DRONE_ARM_VISUALS.filter((part) => showConstraints || part.appearance !== "constraint"),
    [showConstraints],
  );
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
      count: state.receipts.length,
      content: <ReceiptLedger receipts={state.receipts} />,
    },
    {
      id: "agents" as const,
      label: "Agent tools",
      content: <FoundationTools state={state} services={services} />,
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
          || (!nextVariant && !readyToCompare && !pendingPromotion)
        }
        cancelVisible={state.operationStatus === "running"}
        onPrimary={runPrimary}
        onCancel={() => void cancel()}
        onThemeChange={setTheme}
        onOpenComponents={() => setComponentsOpen(true)}
        onOpenInspector={() => setInspectorOpen(true)}
      />
      {error && <p className="global-error" role="alert">{error}</p>}
      <div className="workbench-stage">
        <ComponentBrowser
          selectedId={selectedPart}
          open={componentsOpen}
          onSelect={(id) => { setSelectedPart(id); setComponentsOpen(false); }}
          onClose={() => setComponentsOpen(false)}
        />
        <section className="viewport-workspace" aria-labelledby="viewport-title">
          <header className="viewport-toolbar">
            <div><h2 id="viewport-title">Assembly viewport</h2><p>{state.context.selection.label}</p></div>
            <div className="toolbar-controls">
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
                aria-pressed={showConstraints}
                onClick={() => setShowConstraints((shown) => !shown)}
              >Constraints</button>
            </div>
          </header>
          <div className="viewport-canvas">
            <FieldViewer
              current={viewerCurrent}
              alternatives={viewerAlternatives}
              selectedRegion={state.context.selection}
              threshold={0.5}
              mode={mode}
              grid={state.context.grid}
              assemblyParts={visibleParts}
              selectedAlternative={selectedAlternative}
              selectedPart={selectedPart}
              statusText={viewerCurrent
                ? undefined
                : pendingPromotion
                  ? "Verified branch ready for human review"
                  : undefined}
              environment={viewerEnvironment}
              onPartSelect={setSelectedPart}
            />
            {viewerCurrent && alternatives.length > 0 && (
              <div className="alternative-selector" aria-label="Rendered alternatives">
                {alternatives.map((branch, index) => (
                  <button
                    type="button"
                    key={branch.branchRevision}
                    aria-pressed={selectedAlternative === branch.branchRevision}
                    onClick={() => setSelectedAlternative(branch.branchRevision)}
                  >Alternative {index + 1}</button>
                ))}
              </div>
            )}
          </div>
          <WorkbenchDrawer active={activeDrawer} items={drawerItems} onChange={setActiveDrawer} />
        </section>
        <InspectorPanel
          selectedId={selectedPart}
          context={state.context}
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          onLockCableClearance={() => void intervene()}
        />
      </div>
    </main>
  );
}
