import { useMemo, useState } from "react";

import { evaluateInventory } from "../domain/design";
import type { GpuCapability } from "../gpu/capabilities";
import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import { FieldViewer, type FieldViewerEnvironment } from "../viewer/FieldViewer";
import type { AlternativeMode, SelectedSemanticRegion, ViewerBranch } from "../viewer/alternative-instances";
import type { VoxelGrid } from "../viewer/field-instances";
import { FoundationTools } from "../webmcp/FoundationTools";
import type { ProbeComparisonFacts, ProbeVariant } from "../webmcp/schemas";
import { EvidencePanel } from "./EvidencePanel";
import { ExperimentRail } from "./ExperimentRail";
import { ReceiptLedger } from "./ReceiptLedger";
import { useProjectState } from "./useProjectState";

const fixture = DRONE_ARM_FOUNDATION_STUDY;
const inventoryEvaluation = evaluateInventory(fixture.inventory, fixture.assembly);
const initialSelection = { id: "motor-side-arm-span", label: "Motor-side arm span" };
const initialLocks = ["body-fixed-region"];
const initialAcceptedRevision = fixture.assembly.revision;

const regions: Record<string, SelectedSemanticRegion> = {
  "motor-side-arm-span": {
    id: "motor-side-arm-span", label: "Motor-side arm span",
    min: [16, 4, 0], maxExclusive: [32, 28, 32],
  },
  "cable-clearance": {
    id: "cable-clearance", label: "Cable clearance corridor",
    min: [12, 8, 4], maxExclusive: [26, 20, 26],
  },
};

const grid: VoxelGrid = {
  dimensions: { width: 32, height: 32, depth: 32 },
  cellSize: [110 / 32, 42 / 32, 18 / 32],
  anchor: { position: [-14, -21, -6], orientation: [0, 0, 0, 1] },
};

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
    acceptedBranchRevision: initialAcceptedRevision,
    selection: initialSelection,
    locks: initialLocks,
    capability,
    compute,
  });
  const [mode, setMode] = useState<AlternativeMode>("overlay");
  const [selectedAlternative, setSelectedAlternative] = useState<string>();
  const [comparison, setComparison] = useState<ProbeComparisonFacts>();
  const [error, setError] = useState<string>();

  const accepted = state.stagedBranches.find(
    (branch) => branch.branchRevision === state.acceptedBranchRevision && branch.result?.status === "verified",
  );
  const alternatives = state.stagedBranches.filter(
    (branch) => branch.branchRevision !== state.acceptedBranchRevision && branch.result?.status === "verified",
  );
  const viewerCurrent: ViewerBranch | null = accepted?.result?.status === "verified"
    ? { branchRevision: state.contextRevision, parentRevision: accepted.parentRevision, grid, result: accepted.result }
    : null;
  const viewerAlternatives: readonly ViewerBranch[] = alternatives.map((branch) => ({
    branchRevision: branch.branchRevision,
    parentRevision: branch.parentRevision,
    grid,
    result: branch.result!,
  }));
  const selectedRegion = regions[state.selection.id] ?? regions["motor-side-arm-span"]!;

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
  const retrying = nextVariant !== undefined && latestVariant(nextVariant) !== undefined;
  const primaryLabel = capability.status !== "available" ? "Run foundation probe"
    : nextVariant === "baseline" ? `${retrying ? "Retry" : "Run"} baseline verification`
    : nextVariant === "edge-biased" ? `${retrying ? "Retry" : "Run"} edge-biased alternative`
      : nextVariant === "center-biased" ? `${retrying ? "Retry" : "Run"} center-biased alternative`
        : accepted ? "Alternatives ready to compare" : "Baseline verified—promote below";

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
      if (!left || !right) throw new Error("Two exact verified non-stale alternatives are required");
      setComparison(await services.compareProbes({ leftRevision: left.branchRevision, rightRevision: right.branchRevision }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const cancel = async () => {
    setError(undefined);
    try {
      await services.cancelProbe();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const intervene = async () => {
    setError(undefined);
    try {
      await experimentRail.intervene({
        selection: { id: "cable-clearance", label: "Cable clearance corridor" },
        locks: [...state.locks, "cable-clearance"],
      });
      setComparison(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const journeyState = useMemo(() => ({
    proposed: state.stagedBranches.length > 0,
    verified: state.stagedBranches.some((branch) => branch.status === "verified"),
    compared: comparison !== undefined,
    stale: state.stagedBranches.some((branch) => branch.stale),
    promoted: state.acceptedBranchRevision !== initialAcceptedRevision,
  }), [state, comparison]);

  return (
    <main className="workbench">
      <header className="hero">
        <div>
          <p className="eyebrow">Local agentic engineering foundation</p>
          <h1>Structural Evolution</h1>
          <p className="lede">Inspect one exact drone-arm configuration, stage reversible alternatives, and promote only evidence a human has verified.</p>
        </div>
        <div className={`capability-badge capability-badge--${capability.status}`} role="status">
          <strong>WebGPU {capability.status}</strong><span>{capability.message}</span>
        </div>
        <div className="probe-actions">
          <button
            className="primary-action"
            type="button"
            disabled={!nextVariant || capability.status !== "available" || state.operationStatus === "running"}
            onClick={() => nextVariant && void runVariant(nextVariant)}
          >{state.operationStatus === "running" ? "Probe running…" : primaryLabel}</button>
          {state.operationStatus === "running" && (
            <button className="cancel-action" type="button" onClick={() => void cancel()}>
              Cancel running probe
            </button>
          )}
        </div>
        {error && <p className="inline-error" role="alert">{error}</p>}
      </header>

      <ol className="journey-strip" aria-label="Foundation journey">
        <li data-complete>Inspect</li><li data-complete={journeyState.proposed}>Propose</li>
        <li data-complete={journeyState.verified}>Verify</li><li data-complete={journeyState.compared}>Compare</li>
        <li data-complete={journeyState.stale}>Intervene</li><li data-complete={journeyState.promoted}>Promote</li>
      </ol>

      <section className="fixture-grid" aria-label="Exact fixture and selected configuration">
        <article className="fixture-card">
          <p className="eyebrow">Exact input fixture</p>
          <h2>Drone motor-arm foundation study</h2>
          <dl className="fact-list">
            <div><dt>Study revision</dt><dd><code>{fixture.study.revision}</code></dd></div>
            <div><dt>Selection</dt><dd>{state.selection.label} <code>{state.selection.id}</code></dd></div>
            <div><dt>Constraint handshake</dt><dd>{state.locks.join(", ")}</dd></div>
            <div><dt>Interfaces</dt><dd>{fixture.assembly.preservedMounts.length} preserved mounts · {fixture.assembly.obstacleVolumes.length} keep-outs</dd></div>
            <div><dt>Inventory</dt><dd>{inventoryEvaluation.status}; {inventoryEvaluation.shortages.length} exact shortfall</dd></div>
          </dl>
          <button
            type="button"
            disabled={state.locks.includes("cable-clearance")}
            onClick={() => void intervene()}
          >{state.locks.includes("cable-clearance") ? "Cable clearance locked" : "Lock cable clearance"}</button>
        </article>

        <div className="viewer-shell">
          <p className="anchor-note">Overlay, peel, and audition keep every alternative as an exact configuration at the shared assembly anchor.</p>
          <FieldViewer
            current={viewerCurrent}
            alternatives={viewerAlternatives}
            selectedRegion={selectedRegion}
            threshold={0.5}
            mode={mode}
            selectedAlternative={selectedAlternative}
            environment={viewerEnvironment}
            onModeChange={setMode}
            onAlternativeSelect={setSelectedAlternative}
          />
        </div>
      </section>

      <EvidencePanel state={state} comparison={comparison} initialAcceptedRevision={initialAcceptedRevision} />

      <section className="comparison-actions" aria-label="Exact comparison actions">
        <button type="button" disabled={currentVerified.length < 2} onClick={() => void compare()}>
          Compare verified alternatives
        </button>
        <p>Comparison requires two verified, non-stale branches with the exact same parent revision.</p>
      </section>

      <ExperimentRail state={state} api={experimentRail} />
      <ReceiptLedger receipts={state.receipts} />
      <details className="agent-details">
        <summary>Agent access and protocol status</summary>
        <FoundationTools state={state} services={services} />
      </details>
    </main>
  );
}
