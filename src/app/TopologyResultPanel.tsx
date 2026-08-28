import { useState } from "react";

import type { ViewerBranch } from "../viewer/alternative-instances";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import { downloadEngineeringAssemblyGlb } from "../manufacturing/engineering-assembly-glb";
import { downloadTopologyStl } from "../manufacturing/topology-stl";
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
  branch, variant = "balanced", assemblyParts = [], assemblyId, topologySubject, materialLabel, loadCaseIds,
}: TopologyResultPanelProps) {
  const [exported, setExported] = useState(false);
  const [glbStatus, setGlbStatus] = useState<"idle" | "exporting" | "exported" | "error">("idle");
  if (branch.result.status !== "verified" || !branch.result.topology) return null;
  const output = branch.result.output;
  const metrics = branch.result.topology;
  const removed = 1 - metrics.materialFraction;
  const improvement = 1 - metrics.finalCompliance / metrics.initialCompliance;
  const safe = metrics.minimumSafetyFactor >= 1;
  return (
    <section className="topology-result" aria-label="Topology result">
      <div className="topology-result__header">
        <div><strong>Optimized {topologySubject}</strong><span>{variant} · {materialLabel}</span></div>
        <span className={`topology-result__status ${safe ? "" : "topology-result__status--unsafe"}`}>{safe ? "Provisional axial screen" : "Fails provisional axial screen"}</span>
      </div>
      <dl>
        <div><dt>Material removed</dt><dd>{percent(removed)}</dd></div>
        <div><dt>Compliance change</dt><dd>{percent(improvement)}</dd></div>
        <div><dt>Peak displacement</dt><dd>{millimetres(metrics.maxDisplacement)} mm</dd></div>
        <div><dt>Peak axial stress</dt><dd>{megapascals(metrics.maxStress)} MPa</dd></div>
        <div><dt>Minimum safety factor</dt><dd>{compact(metrics.minimumSafetyFactor)}×</dd></div>
        <div><dt>Calibration</dt><dd>Continuum FEA pending</dd></div>
        {metrics.assemblyMassKg !== undefined && <div><dt>Accounted assembly mass</dt><dd>{compact(metrics.assemblyMassKg * 1_000)} g</dd></div>}
        {metrics.estimatedFrameMassKg !== undefined && <div><dt>Estimated {materialLabel} {topologySubject} mass</dt><dd>{compact(metrics.estimatedFrameMassKg * 1_000)} g</dd></div>}
        {metrics.planarCenterOfMassOffsetM !== undefined && <div><dt>Planar CG offset</dt><dd>{compact(metrics.planarCenterOfMassOffsetM * 1_000)} mm</dd></div>}
        <div><dt>Structural cases</dt><dd>{loadCaseIds.join(" · ")}</dd></div>
        <div><dt>Physical solve</dt><dd>{loadCaseIds.length} cases · {metrics.iterations} iter · {compact(branch.result.elapsedMs)} ms</dd></div>
      </dl>
      <button
        type="button"
        className="topology-result__export"
        disabled={!safe}
        onClick={() => {
          downloadTopologyStl(branch.grid, output);
          setExported(true);
        }}
      >{!safe ? "STL blocked: unsafe candidate" : exported ? "STL exported" : `Export ${topologySubject} STL`}</button>
      <button
        type="button"
        className="topology-result__export"
        disabled={!safe || glbStatus === "exporting"}
        onClick={() => {
          setGlbStatus("exporting");
          void downloadEngineeringAssemblyGlb(branch.grid, output, assemblyParts, {
            assemblyName: `verified_${assemblyId}_engineering_assembly`,
            topologyName: `verified_topology_${topologySubject}_${materialLabel}`,
            filename: `verified-${assemblyId}-engineering-assembly.glb`,
          })
            .then(() => setGlbStatus("exported"))
            .catch(() => setGlbStatus("error"));
        }}
      >{!safe ? "GLB blocked: unsafe candidate" : glbStatus === "exporting" ? "Building PBR GLB…" : glbStatus === "exported" ? "Assembly GLB exported" : glbStatus === "error" ? "GLB export failed · retry" : "Export PBR assembly GLB"}</button>
    </section>
  );
}
