import { useEffect, useRef, useState } from "react";

import {
  flightFrameAt,
  FLIGHT_SCENARIOS,
  type FlightFrame,
  type FlightMotor,
  type FlightScenarioId,
} from "./flight-scenarios";
import { STRUCTURAL_DEFORMATION_EXAGGERATION } from "../viewer/replay-deformation";
import "./flight-simulation-panel.css";

export interface FlightSimulationPanelProps {
  readonly motors: readonly FlightMotor[];
  readonly massKg: number;
  readonly componentCount: number;
  readonly batteryMassKg: number;
  readonly onFrame: (frame: FlightFrame | undefined) => void;
  readonly onActiveChange?: (active: boolean) => void;
  readonly componentsVisible: boolean;
  readonly onComponentsVisibleChange: (visible: boolean) => void;
  readonly caseMaximumDisplacementM?: Readonly<Record<string, number | undefined>>;
  readonly command?: FlightReplayCommand;
}

export interface FlightReplayCommand {
  readonly requestId: number;
  readonly scenario: FlightScenarioId;
}

const number = (value: number, digits = 2) => value.toFixed(digits);

export function FlightSimulationPanel({
  motors,
  massKg,
  componentCount,
  batteryMassKg,
  onFrame,
  onActiveChange,
  componentsVisible,
  onComponentsVisibleChange,
  caseMaximumDisplacementM,
  command,
}: FlightSimulationPanelProps) {
  const [scenario, setScenario] = useState<FlightScenarioId>("hover");
  const [running, setRunning] = useState(false);
  const [frame, setFrame] = useState<FlightFrame>();
  const startedAt = useRef(0);
  const lastReadoutAt = useRef(0);
  const onFrameRef = useRef(onFrame);
  const onActiveChangeRef = useRef(onActiveChange);
  onFrameRef.current = onFrame;
  onActiveChangeRef.current = onActiveChange;

  useEffect(() => {
    if (!command || motors.length !== 4) return;
    setScenario(command.scenario);
    setRunning(true);
  }, [command?.requestId, command?.scenario, motors.length]);

  useEffect(() => {
    if (!running || motors.length !== 4) return;
    onActiveChangeRef.current?.(true);
    startedAt.current = performance.now();
    let handle = 0;
    const update = (now: number) => {
      const next = flightFrameAt(scenario, (now - startedAt.current) / 1_000, motors, massKg);
      if (now - lastReadoutAt.current >= 100) {
        lastReadoutAt.current = now;
        setFrame(next);
      }
      onFrameRef.current(next);
      handle = requestAnimationFrame(update);
    };
    handle = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(handle);
      setFrame(undefined);
      onFrameRef.current(undefined);
      onActiveChangeRef.current?.(false);
    };
  }, [massKg, motors, running, scenario]);

  const toggleRunning = () => setRunning((active) => !active);
  const activeCase = FLIGHT_SCENARIOS.find(({ id }) => id === scenario)!;
  const physicalPeakM = caseMaximumDisplacementM?.[activeCase.solverCase];

  if (motors.length !== 4) return (
    <aside className="flight-simulation" aria-label="Flight load simulation">
      <div className="flight-simulation__heading">
        <div><strong>Topology case replay</strong><span>4 deterministic load cases</span></div>
      </div>
      <p className="flight-simulation__empty" role="status">
        Generate a topology candidate before replaying its load cases.
      </p>
      <button className="flight-simulation__run" type="button" aria-label="Run flight replay" disabled>
        Run replay
      </button>
    </aside>
  );

  return (
    <aside className="flight-simulation" aria-label="Flight load simulation">
      <div className="flight-simulation__heading">
        <div><strong>Topology case replay</strong><span>4 deterministic load cases</span></div>
      </div>
      <div className="flight-simulation__view" role="group" aria-label="Replay geometry">
        <button type="button" aria-pressed={!componentsVisible} onClick={() => onComponentsVisibleChange(false)}>Frame only</button>
        <button type="button" aria-pressed={componentsVisible} onClick={() => onComponentsVisibleChange(true)}>Full assembly</button>
      </div>
      <p className="flight-simulation__mass">Mass model: {number(massKg * 1_000, 0)} g · {componentCount} attached parts · battery {number(batteryMassKg * 1_000, 0)} g</p>
      <div className="flight-simulation__scenarios" role="group" aria-label="Flight scenario">
        {FLIGHT_SCENARIOS.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-label={item.label}
            aria-pressed={scenario === item.id}
            onClick={() => setScenario(item.id)}
          >{item.label}</button>
        ))}
      </div>
      <p>{activeCase.description}{scenario === "yaw" && " Displayed vectors are tangential X/Y loads producing torque about Z."}</p>
      <dl className="flight-simulation__field-basis" aria-label="Replay field basis">
        <div><dt>Active case</dt><dd>{activeCase.label} · {activeCase.solverCase}</dd></div>
        {physicalPeakM !== undefined && Number.isFinite(physicalPeakM) && <div>
          <dt>Physical peak</dt><dd>{physicalPeakM * 1_000 > 0 && physicalPeakM * 1_000 < 0.1
            ? (physicalPeakM * 1_000).toFixed(3) : number(physicalPeakM * 1_000)} mm</dd>
        </div>}
        <div><dt>Deformation</dt><dd>{STRUCTURAL_DEFORMATION_EXAGGERATION}× visual</dd></div>
      </dl>
      {frame && <dl className="flight-simulation__metrics">
        <div><dt>Load factor</dt><dd>{number(frame.loadFactorG)} g</dd></div>
        <div><dt>Thrust</dt><dd>{number(frame.resultantForceN[2])} N</dd></div>
        <div><dt>Torque X/Y/Z</dt><dd>{frame.resultantTorqueNm.map((value) => number(value, 3)).join(" / ")} N·m</dd></div>
        <div><dt>Vertical accel.</dt><dd>{number(frame.linearAccelerationMps2[2])} m/s²</dd></div>
      </dl>}
      <button
        className="flight-simulation__run"
        type="button"
        aria-label={running ? "Pause flight replay" : "Run flight replay"}
        disabled={motors.length !== 4}
        onClick={toggleRunning}
      >{running ? "Pause replay" : "Run replay"}</button>
      <small>Color and deformation interpolate the precomputed linear-static case; replay does not re-solve, verify, or approve it. Structural only—no drone thermal field.</small>
    </aside>
  );
}
