import type { ViewerBranch } from "../viewer/alternative-instances";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import "./topology-result-panel.css";

export interface TopologyResultPanelProps {
  readonly branch: ViewerBranch;
  readonly variant?: string;
  readonly assemblyParts?: readonly AssemblyVisualPart[];
  readonly assemblyId: string;
  readonly topologySubject: string;
  readonly materialLabel: string;
  readonly loadCaseIds: readonly string[];
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const compact = (value: number) => value >= 100 ? value.toFixed(0) : value.toFixed(2);
const millimetres = (value: number) => {
  const mm = value * 1_000;
  return mm > 0 && mm < 0.1 ? mm.toFixed(3) : compact(mm);
};
const megapascals = (value: number) => compact(value / 1_000_000);

export function TopologyResultPanel({
  branch, variant = "balanced", topologySubject, materialLabel, loadCaseIds,
}: TopologyResultPanelProps) {
  const result = branch.result;
  if ((result.status !== "verified" && result.status !== "estimate") || !result.topology) return null;
  const estimate = result.status === "estimate";
  const metrics = result.topology;
  const removed = 1 - metrics.materialFraction;
  const improvement = 1 - metrics.finalCompliance / metrics.initialCompliance;
  const safe = metrics.minimumSafetyFactor >= 1;
  return (
    <section className="topology-result" aria-label="Topology result">
      <div className="topology-result__header">
        <div><strong>{estimate ? "Interactive estimate preview" : `Optimized ${topologySubject}`}</strong><span>{variant} · {materialLabel}</span></div>
        <span className={`topology-result__status ${safe ? "" : "topology-result__status--unsafe"}`}>{estimate ? "Unverified · unaccepted" : safe ? "Provisional axial screen" : "Fails provisional axial screen"}</span>
      </div>
      <dl>
        <div><dt>Material removed</dt><dd>{percent(removed)}</dd></div>
        <div><dt>Compliance change</dt><dd>{percent(improvement)}</dd></div>
        <div><dt>Peak displacement</dt><dd>{millimetres(metrics.maxDisplacement)} mm</dd></div>
        <div><dt>Peak axial stress</dt><dd>{megapascals(metrics.maxStress)} MPa</dd></div>
        <div><dt>Minimum safety factor</dt><dd>{compact(metrics.minimumSafetyFactor)}×</dd></div>
        <div><dt>Calibration</dt><dd>Continuum FEA pending</dd></div>
      </dl>
      <details className="topology-result__details">
        <summary>Solve details</summary>
        <dl>
          {metrics.assemblyMassKg !== undefined && <div><dt>Assembly mass</dt><dd>{compact(metrics.assemblyMassKg * 1_000)} g</dd></div>}
          {metrics.estimatedFrameMassKg !== undefined && <div><dt>Estimated {materialLabel} {topologySubject}</dt><dd>{compact(metrics.estimatedFrameMassKg * 1_000)} g</dd></div>}
          {metrics.planarCenterOfMassOffsetM !== undefined && <div><dt>Planar CG offset</dt><dd>{compact(metrics.planarCenterOfMassOffsetM * 1_000)} mm</dd></div>}
          <div><dt>Structural cases</dt><dd>{loadCaseIds.join(" · ")}</dd></div>
          <div><dt>Physical solve</dt><dd>{loadCaseIds.length} cases · {metrics.iterations} iter · {compact(result.elapsedMs)} ms</dd></div>
        </dl>
      </details>
      <p className="topology-result__note">{estimate
        ? "Interactive estimate only. Replay displays its existing case fields; promotion and manufacturing export remain unavailable."
        : "Manufacturing export requires promoted post-extraction evidence."}</p>
    </section>
  );
}
