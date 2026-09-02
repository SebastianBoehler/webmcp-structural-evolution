import { useEffect, useMemo, useRef, useState, type JSX } from "react";

import {
  runThermalBrowserGate, type ThermalBrowserGateSession,
} from "../solver/thermal/browser-thermal-gate";
import { ThermalTools, type ThermalGateService } from "../webmcp/thermal-tools";
import { ThermalFieldViewport } from "./ThermalFieldViewport";
import { ShowcaseModelEvidence } from "./ShowcaseModelEvidence";
import "./thermal-gate.css";

type State = { readonly kind: "running" | "cancelled" }
  | { readonly kind: "complete"; readonly session: ThermalBrowserGateSession };

export interface ThermalGateRouteProps {
  readonly runGate?: (signal: AbortSignal) => Promise<ThermalBrowserGateSession>;
}

export function ThermalGateRoute({ runGate = runThermalBrowserGate }: ThermalGateRouteProps): JSX.Element {
  const [run, setRun] = useState(0), [state, setState] = useState<State>({ kind: "running" });
  const controller = useRef<AbortController | undefined>(undefined);
  const service = useMemo<ThermalGateService>(() => ({ run: runGate }), [runGate]);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    setState({ kind: "running" });
    void service.run(active.signal).then((session) => {
      if (!active.signal.aborted) setState({ kind: "complete", session });
    }).catch((error: unknown) => {
      if (!active.signal.aborted) console.error("Thermal gate runner rejected", error);
    });
    return () => active.abort();
  }, [run, service]);
  const report = state.kind === "complete" ? state.session.report : undefined;
  return <main className="thermal-gate" aria-label="SE-6 cobot thermal browser gate">
    <header><h1>SE-6 cobot steady-thermal gate</h1>
      <p>80 W motor-interface heating through an exact aluminum upper-arm link to a 300 K mounting interface.</p>
      <div className="thermal-gate__buttons">
        <button type="button" onClick={() => setRun((value) => value + 1)}>Run gate again</button>
        {state.kind === "running" && <button type="button" onClick={() => {
          controller.current?.abort(); setState({ kind: "cancelled" });
        }}>Cancel live run</button>}
      </div>
      <ThermalTools service={service}/>
    </header>
    {state.kind === "running" && <p role="status">Building exact geometry, probing cancellation, solving on WebGPU, then verifying privately in Wasm…</p>}
    {state.kind === "cancelled" && <p role="status">Live run cancelled. No result artifact was authorized. Restart when ready.</p>}
    {state.kind === "complete" && state.session.model
      && <ShowcaseModelEvidence models={[state.session.model]}/>}
    {report?.status === "blocked" && <p role="alert">Blocked at {report.blocker.stage}: {report.blocker.message}</p>}
    {state.kind === "complete" && report?.status === "passed" && <>
      <p className="thermal-gate__passed" role="status">Live thermal solve evidence passed. Viewport verification is reported separately.</p>
      <ThermalFieldViewport session={state.session}/>
      <section className="thermal-gate__evidence" aria-labelledby="thermal-evidence-title">
        <h2 id="thermal-evidence-title">Measured live evidence</h2>
        <dl>
          <div><dt>Temperature</dt><dd>{report.solve.minimumTemperatureK.toFixed(2)}–{report.solve.maximumTemperatureK.toFixed(2)} K</dd></div>
          <div><dt>Heat input</dt><dd>{report.boundaries.heatInputW.toFixed(1)} W</dd></div>
          <div><dt>WebGPU residual</dt><dd>{report.solve.relativeResidual.toExponential(3)}</dd></div>
          <div><dt>Energy imbalance</dt><dd>{report.solve.relativeEnergyImbalance.toExponential(3)}</dd></div>
          <div><dt>Wasm temperature L2</dt><dd>{report.verification.temperatureRelativeL2.toExponential(3)}</dd></div>
          <div><dt>Persistence</dt><dd>{report.artifacts.length} verified artifacts</dd></div>
          <div><dt>Cancellation</dt><dd>one terminal · zero commits · recovery passed</dd></div>
          <div><dt>Device</dt><dd>{report.device.vendor} / {report.device.architecture}</dd></div>
        </dl>
        <details><summary>Sealed thermal report</summary><pre>{JSON.stringify(report, null, 2)}</pre></details>
      </section>
    </>}
  </main>;
}
