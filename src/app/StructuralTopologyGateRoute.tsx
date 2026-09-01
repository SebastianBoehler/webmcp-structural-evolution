import { useEffect, useState, type JSX } from "react";

import {
  runStructuralTopologyBrowserGateSession, serializeLiveAcceptedTopologyStl,
  type StructuralTopologyGateReport,
} from "../solver/structural/browser-structural-gate";
import { ShowcaseModelEvidence } from "./ShowcaseModelEvidence";

interface GateView {
  readonly report: StructuralTopologyGateReport;
  readonly models: Awaited<ReturnType<typeof runStructuralTopologyBrowserGateSession>>["models"];
  readonly serializedBytes?: Readonly<{ drone: number; cobot: number }>;
}

export function StructuralTopologyGateRoute(): JSX.Element {
  const [view, setView] = useState<GateView>();
  const [run, setRun] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setView(undefined);
    void runStructuralTopologyBrowserGateSession(controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      const serializedBytes = next.capability ? {
        drone: serializeLiveAcceptedTopologyStl(next.capability, "drone").byteLength,
        cobot: serializeLiveAcceptedTopologyStl(next.capability, "cobot").byteLength,
      } : undefined;
      setView({ report: next.report, models: next.models, serializedBytes });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) console.error("Structural topology gate runner rejected", error);
    });
    return () => controller.abort();
  }, [run]);

  return <main style={{ fontFamily: "ui-monospace, monospace", padding: "2rem", maxWidth: 960 }}>
    <h1>Structural + topology live WebGPU gate</h1>
    <p>This isolated route runs exact CAD, structural analysis, topology optimization, recovery, and audit checks.</p>
    <button type="button" onClick={() => setRun((value) => value + 1)}>Run gate again</button>
    {!view ? <p role="status">Running live gate…</p> : <>
      <ShowcaseModelEvidence models={view.models}/>
      <p role={view.report.status === "blocked" ? "alert" : "status"}>
        {view.report.status === "passed"
          ? `Live gate passed; session-bound STL serialization verified (${view.serializedBytes?.drone ?? 0} drone bytes, ${view.serializedBytes?.cobot ?? 0} cobot bytes).`
          : `Blocked at ${view.report.blocker.stage}: ${view.report.blocker.message}`}
      </p>
      <pre data-testid="structural-topology-gate-report">
        {JSON.stringify(view.report, null, 2)}
      </pre>
    </>}
  </main>;
}
