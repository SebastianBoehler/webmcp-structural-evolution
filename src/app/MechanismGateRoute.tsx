import { useEffect, useMemo, useRef, useState, type JSX } from "react";

import { createMechanismVisualFrame } from "../samples/cobot/cobot-mechanism-visuals";
import {
  runMechanismBrowserGate, type MechanismBrowserGateSession,
} from "../simulation/browser-mechanism-gate";
import { FieldViewer } from "../viewer/FieldViewer";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import { ShowcaseModelEvidence } from "./ShowcaseModelEvidence";
import "./mechanism-gate.css";

const grid = { dimensions: { width: 1, height: 1, depth: 1 }, cellSize: [1, 1, 1] as const,
  anchor: { position: [0, 0, 0] as const, orientation: [0, 0, 0, 1] as const } };
const selection = { id: "se6", label: "SE-6 cobot", min: [0, 0, 0] as const,
  maxExclusive: [1, 1, 1] as const };
type RouteState = Readonly<{ kind: "running" | "cancelled"; run: number }>
  | Readonly<{ kind: "failed"; run: number; message: string }>
  | Readonly<{ kind: "complete"; run: number; session: MechanismBrowserGateSession }>;

function ReplayView({ session }: { readonly session: MechanismBrowserGateSession }) {
  const { benchmark, input, result, report } = session;
  if (!benchmark || !input || !result || report.status !== "passed") return null;
  const frames = useMemo(() => result.replay.frames.map((_frame, frameIndex) =>
    createMechanismVisualFrame(benchmark.visualParts, benchmark.partBodyIds, input,
      result.replay, frameIndex)), [benchmark, input, result]);
  const catalog = useMemo(() => {
    const byId = new Map<string, AssemblyVisualPart>();
    for (const frame of frames) for (const part of [...frame.parts, ...frame.overlay.parts]) {
      if (!byId.has(part.id)) byId.set(part.id, part);
    }
    return [...byId.values()];
  }, [frames]);
  const [frameIndex, setFrameIndex] = useState(0), [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setFrameIndex((value) => (value + 1) % frames.length), 1_000 / 60);
    return () => clearInterval(timer);
  }, [frames.length, playing]);
  const frame = frames[frameIndex]!;
  const poseParts = [...frame.parts, ...frame.overlay.parts];
  const minimumClearance = frame.overlay.clearances.reduce(
    (minimum, sample) => Math.min(minimum, sample.distanceM), Number.POSITIVE_INFINITY);
  return <>
    <section className="mechanism-gate__viewer" aria-label="Six-axis cobot motion replay">
      <FieldViewer current={null} alternatives={[]} selectedRegion={selection}
        threshold={.5} mode="overlay" grid={grid} assemblyParts={catalog}
        assemblyPoseParts={poseParts} preserveDrawingBuffer
        statusText={`Passive force response · frame ${frameIndex + 1}/${frames.length}`}/>
    </section>
    <section className="mechanism-gate__playback" aria-label="Mechanism playback controls">
      <div className="mechanism-gate__buttons">
        <button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? "Pause replay" : "Resume replay"}</button>
        <button type="button" onClick={() => { setFrameIndex(0); setPlaying(false); }}>Restart replay</button>
      </div>
      <p data-testid="mechanism-frame">Frame {frameIndex + 1}/{frames.length} · step {frame.stepIndex} · {(frame.stepIndex / 240).toFixed(3)} s</p>
      <p data-testid="mechanism-overlay">Clearance overlay: {frame.overlay.clearances.length} pairs,
        minimum {Number.isFinite(minimumClearance) ? `${(minimumClearance * 1_000).toFixed(3)} mm` : "n/a"};
        active contacts {frame.overlay.contacts.length}.</p>
    </section>
    <Evidence report={report}/>
  </>;
}

function Evidence({ report }: { readonly report: Extract<MechanismBrowserGateSession["report"], { status: "passed" }> }) {
  const motion = report.motion.maximumJointDeltaFromAuthoredPoseRad;
  return <section className="mechanism-gate__evidence" aria-labelledby="mechanism-evidence-title">
    <h2 id="mechanism-evidence-title">Measured live evidence</h2>
    <dl>
      <div><dt>Mechanism</dt><dd>{report.benchmark.revoluteJointCount} revolute axes · fixed {report.benchmark.fixedBodyIds.join(", ")}</dd></div>
      <div><dt>Motion from authored pose</dt><dd>{report.motion.movingJointIds.map((id) => `${id} ${motion[id]!.toFixed(4)} rad`).join(" · ")}</dd></div>
      <div><dt>Joint anchor error</dt><dd>{report.motion.maximumJointErrorM.toExponential(3)} m</dd></div>
      <div><dt>Collision</dt><dd>{report.collision.maximumPenetrationM.toExponential(3)} m max penetration</dd></div>
      <div><dt>Clearance</dt><dd>{(report.collision.minimumRequestedClearanceM * 1_000).toFixed(3)} mm minimum · {report.collision.clearanceSampleCount} samples</dd></div>
      <div><dt>Replay</dt><dd>{report.benchmark.frameCount} frames at {report.benchmark.outputHz} Hz</dd></div>
      <div><dt>Cancellation</dt><dd>cancelled in flight · {report.cancellation.artifactsCommitted} artifacts committed · recovery passed</dd></div>
      <div><dt>Runtime</dt><dd>{report.runtime.runtimeVersion}</dd></div>
      <div><dt>Solver phase console</dt><dd>{report.solverPhaseConsole.warningCount} warnings · {report.solverPhaseConsole.errorCount} errors.
        Browser UI console is measured independently after mount and is not part of this sealed report.</dd></div>
      <div><dt>Gate time</dt><dd>{report.timingsMs.total.toFixed(1)} ms</dd></div>
    </dl>
    <details><summary>Sealed audit report</summary>
      <pre data-testid="mechanism-gate-report">{JSON.stringify(report, null, 2)}</pre>
    </details>
  </section>;
}

export interface MechanismGateRouteProps {
  readonly runGate?: (signal: AbortSignal) => Promise<MechanismBrowserGateSession>;
}

export function MechanismGateRoute({ runGate = runMechanismBrowserGate }: MechanismGateRouteProps): JSX.Element {
  const [run, setRun] = useState(0), [state, setState] = useState<RouteState>({ kind: "running", run: 0 });
  const controllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: "running", run });
    void runGate(controller.signal).then((session) => {
      if (!controller.signal.aborted) setState({ kind: "complete", run, session });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("Mechanism gate runner rejected", error);
        setState({ kind: "failed", run, message: error instanceof Error ? error.message : String(error) });
      }
    });
    return () => controller.abort();
  }, [run, runGate]);
  const restart = () => setRun((value) => value + 1);
  const cancel = () => { controllerRef.current?.abort(); setState({ kind: "cancelled", run }); };
  const report = state.kind === "complete" ? state.session.report : undefined;
  return <main className="mechanism-gate" aria-label="SE-6 mechanism browser gate">
    <header><p className="mechanism-gate__eyebrow">Exact CAD + deterministic browser dynamics</p>
      <h1>SE-6 six-axis cobot mechanism gate</h1>
      <p>Passive gravity and applied-force response in the production Rapier/Wasm worker. The semantic viewport uses WebGPU; this route does not claim WebGPU physics.</p>
      <div className="mechanism-gate__buttons">
        <button type="button" onClick={restart}>Run gate again</button>
        {state.kind === "running" && <button type="button" onClick={cancel}>Cancel live run</button>}
      </div>
    </header>
    {state.kind === "running" && <p role="status">Building exact geometry, probing cancellation, then solving the full replay…</p>}
    {state.kind === "cancelled" && <p role="status">Live run cancelled. No result artifact was authorized. Restart when ready.</p>}
    {state.kind === "failed" && <p role="alert">Blocked at route-runner: {state.message}</p>}
    {state.kind === "complete" && state.session.model
      && <ShowcaseModelEvidence models={[state.session.model]}/>}
    {report?.status === "blocked" && <p role="alert">Blocked at {report.blocker.stage}: {report.blocker.message}</p>}
    {state.kind === "complete" && report?.status === "passed" && <ReplayView session={state.session}/>}
  </main>;
}
