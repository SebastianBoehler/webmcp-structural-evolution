import { useEffect, useState, type JSX } from "react";

import {
  runComponentTopologyGate, type ComponentTopologyGateReport,
} from "../solver/structural/component-topology-gate";

export interface ComponentTopologyGateRouteProps {
  readonly runGate?: (signal: AbortSignal) => Promise<ComponentTopologyGateReport>;
}

export function ComponentTopologyGateRoute({
  runGate = runComponentTopologyGate,
}: ComponentTopologyGateRouteProps): JSX.Element {
  const [report, setReport] = useState<ComponentTopologyGateReport>();
  const [failure, setFailure] = useState<string>();
  const [run, setRun] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setReport(undefined); setFailure(undefined);
    void runGate(controller.signal).then((next) => {
      if (!controller.signal.aborted) setReport(next);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("Component topology gate runner rejected", error);
        setFailure(error instanceof Error ? error.message : String(error));
      }
    });
    return () => controller.abort();
  }, [run, runGate]);

  return <main aria-label="Real drone motor-side component topology gate"
    style={{ fontFamily: "ui-monospace, monospace", padding: "2rem", maxWidth: 960 }}>
    <h1>Real drone motor-side component topology gate</h1>
    <p>Runs the authored drone-arm-topology study at its unchanged 0.35 target on live WebGPU.</p>
    <p>The result is an interactive estimate and the captured evidence is audit-only.</p>
    <button type="button" onClick={() => setRun((value) => value + 1)}>Run component gate again</button>
    {failure ? <p role="alert">Blocked at route-runner: {failure}</p>
      : !report ? <p role="status">Running real component topology gate…</p>
        : report.status === "blocked" ? <p role="alert">Blocked at {report.stage}: {report.message}</p>
          : <>
            <p role="status">Audit evidence captured in {report.timingMs.toFixed(1)} ms.
              Task 5 promotion is required before manufacturing authorization.</p>
            <pre data-testid="component-topology-gate-report">
              {JSON.stringify(report, null, 2)}
            </pre>
          </>}
  </main>;
}
