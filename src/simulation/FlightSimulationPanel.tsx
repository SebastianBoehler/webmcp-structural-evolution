import { useEffect, useRef, useState } from "react";

import {
  flightFrameAt,
  FLIGHT_SCENARIOS,
  type FlightFrame,
  type FlightMotor,
  type FlightScenarioId,
} from "./flight-scenarios";
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
      <p>{FLIGHT_SCENARIOS.find(({ id }) => id === scenario)!.description}{scenario === "yaw" && " Displayed vectors are tangential X/Y loads producing torque about Z."}</p>
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
      <small>Shows the candidate's existing case estimate. Replay follows the current assembly; it does not re-solve, verify, or approve the design.</small>
    </aside>
  );
}
