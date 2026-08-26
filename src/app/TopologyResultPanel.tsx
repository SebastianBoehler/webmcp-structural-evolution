import { useState } from "react";

import type { ViewerBranch } from "../viewer/alternative-instances";
import { downloadTopologyStl } from "../manufacturing/topology-stl";
import "./topology-result-panel.css";

export interface TopologyResultPanelProps {
  readonly branch: ViewerBranch;
  readonly variant?: string;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const compact = (value: number) => value >= 100 ? value.toFixed(0) : value.toFixed(2);
const millimetres = (value: number) => compact(value * 1_000);
const megapascals = (value: number) => compact(value / 1_000_000);

export function TopologyResultPanel({ branch, variant = "balanced" }: TopologyResultPanelProps) {
  const [exported, setExported] = useState(false);
  if (branch.result.status !== "verified" || !branch.result.topology) return null;
  const output = branch.result.output;
  const metrics = branch.result.topology;
  const removed = 1 - metrics.materialFraction;
  const improvement = 1 - metrics.finalCompliance / metrics.initialCompliance;
  const safe = metrics.minimumSafetyFactor >= 1;
  return (
    <section className="topology-result" aria-label="Topology result">
      <div className="topology-result__header">
        <div><strong>Optimized frame</strong><span>{variant} · PLA profile</span></div>
        <span className={`topology-result__status ${safe ? "" : "topology-result__status--unsafe"}`}>{safe ? "Passes PLA screen" : "Fails PLA screen"}</span>
      </div>
      <dl>
        <div><dt>Material removed</dt><dd>{percent(removed)}</dd></div>
        <div><dt>Compliance change</dt><dd>{percent(improvement)}</dd></div>
        <div><dt>Peak displacement</dt><dd>{millimetres(metrics.maxDisplacement)} mm</dd></div>
        <div><dt>Peak axial stress</dt><dd>{megapascals(metrics.maxStress)} MPa</dd></div>
        <div><dt>Minimum safety factor</dt><dd>{compact(metrics.minimumSafetyFactor)}×</dd></div>
        <div><dt>Physical solve</dt><dd>4 loads · {metrics.iterations} iter · {compact(branch.result.elapsedMs)} ms</dd></div>
      </dl>
      <button
        type="button"
        className="topology-result__export"
        onClick={() => {
          downloadTopologyStl(branch.grid, output);
          setExported(true);
        }}
      >{exported ? "STL exported" : "Export frame STL"}</button>
    </section>
  );
}
