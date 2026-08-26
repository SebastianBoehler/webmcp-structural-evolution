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
  readonly onFrame: (frame: FlightFrame | undefined) => void;
  readonly onActiveChange?: (active: boolean) => void;
  readonly onDroneOnlyChange: (droneOnly: boolean) => void;
}

const number = (value: number, digits = 2) => value.toFixed(digits);

export function FlightSimulationPanel({
  motors,
  massKg,
  onFrame,
  onActiveChange,
  onDroneOnlyChange,
}: FlightSimulationPanelProps) {
  const [scenario, setScenario] = useState<FlightScenarioId>("hover");
  const [running, setRunning] = useState(false);
  const [droneOnly, setDroneOnly] = useState(false);
  const [frame, setFrame] = useState<FlightFrame>();
  const startedAt = useRef(0);
  const lastReadoutAt = useRef(0);

  useEffect(() => {
    if (!running || motors.length !== 4) return;
    startedAt.current = performance.now();
    let handle = 0;
    const update = (now: number) => {
      const next = flightFrameAt(scenario, (now - startedAt.current) / 1_000, motors, massKg);
      if (now - lastReadoutAt.current >= 100) {
        lastReadoutAt.current = now;
        setFrame(next);
      }
      onFrame(next);
      handle = requestAnimationFrame(update);
    };
    handle = requestAnimationFrame(update);
    return () => cancelAnimationFrame(handle);
  }, [massKg, motors, onFrame, running, scenario]);

  const toggleRunning = () => {
    const next = !running;
    setRunning(next);
    onActiveChange?.(next);
    if (!next) {
      setFrame(undefined);
      onFrame(undefined);
    }
  };

  return (
    <aside className="flight-simulation" aria-label="Flight load simulation">
      <div className="flight-simulation__heading">
        <div><strong>Flight load replay</strong><span>4 optimizer cases</span></div>
        <button
          type="button"
          aria-label="Drone-only view"
          aria-pressed={droneOnly}
          onClick={() => {
            const next = !droneOnly;
            setDroneOnly(next);
            onDroneOnlyChange(next);
          }}
        >Drone only</button>
      </div>
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
      <p>{FLIGHT_SCENARIOS.find(({ id }) => id === scenario)!.description}</p>
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
      <small>Rigid-body replay plus linearized structural fields. Not CFD, thermal analysis, or transient continuum FEA.</small>
    </aside>
  );
}
