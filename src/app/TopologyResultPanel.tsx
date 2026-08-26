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

export function TopologyResultPanel({ branch, variant = "balanced" }: TopologyResultPanelProps) {
  const [exported, setExported] = useState(false);
  if (branch.result.status !== "verified" || !branch.result.topology) return null;
  const output = branch.result.output;
  const metrics = branch.result.topology;
  const removed = 1 - metrics.materialFraction;
  const improvement = 1 - metrics.finalCompliance / metrics.initialCompliance;
  return (
    <section className="topology-result" aria-label="Topology result">
      <div className="topology-result__header">
        <div><strong>Optimized frame</strong><span>{variant} · PLA profile</span></div>
        <span className="topology-result__status">Verified</span>
      </div>
      <dl>
        <div><dt>Material removed</dt><dd>{percent(removed)}</dd></div>
        <div><dt>Compliance improvement</dt><dd>{percent(improvement)}</dd></div>
        <div><dt>Peak solver displacement</dt><dd>{compact(metrics.maxDisplacement)} normalized</dd></div>
        <div><dt>Solve</dt><dd>{metrics.iterations} iter · {compact(branch.result.elapsedMs)} ms</dd></div>
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
