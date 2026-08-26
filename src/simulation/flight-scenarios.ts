export type FlightScenarioId = "hover" | "roll" | "pitch" | "yaw";
export type SolverLoadCase = "collective-thrust" | "roll-differential" | "pitch-differential" | "yaw-torsion";
type Point = readonly [number, number, number];

export interface FlightMotor {
  readonly id: string;
  readonly centerM: Point;
}

export interface FlightScenario {
  readonly id: FlightScenarioId;
  readonly label: string;
  readonly solverCase: SolverLoadCase;
  readonly description: string;
}

export interface FlightFrame {
  readonly scenario: FlightScenarioId;
  readonly timeS: number;
  readonly motorThrustN: readonly number[];
  readonly resultantForceN: Point;
  readonly resultantTorqueNm: Point;
  readonly linearAccelerationMps2: Point;
  readonly attitudeRad: Point;
  readonly loadFactorG: number;
}

export const FLIGHT_SCENARIOS: readonly FlightScenario[] = Object.freeze([
  { id: "hover", label: "Hover", solverCase: "collective-thrust", description: "Balanced collective thrust at one-g equilibrium." },
  { id: "roll", label: "Aggressive roll", solverCase: "roll-differential", description: "North/south differential thrust excites arm bending and roll torque." },
  { id: "pitch", label: "Pitch brake", solverCase: "pitch-differential", description: "East/west differential thrust represents a hard pitch reversal." },
  { id: "yaw", label: "Yaw burst", solverCase: "yaw-torsion", description: "Alternating rotor reaction torque excites in-plane torsion." },
]);

const G = 9.80665;
const wave = (timeS: number) => Math.sin(timeS * Math.PI * 2);

function profile(id: FlightScenarioId, timeS: number, hoverN: number): readonly number[] {
  const pulse = wave(timeS);
  if (id === "hover") return [hoverN, hoverN, hoverN, hoverN];
  if (id === "roll") return [hoverN, hoverN * (1 + 0.78 * pulse), hoverN, hoverN * (1 - 0.78 * pulse)];
  if (id === "pitch") return [hoverN * (1 + 0.78 * pulse), hoverN, hoverN * (1 - 0.78 * pulse), hoverN];
  return [hoverN * (1 + 0.38 * pulse), hoverN * (1 - 0.38 * pulse), hoverN * (1 + 0.38 * pulse), hoverN * (1 - 0.38 * pulse)];
}

export function flightFrameAt(
  scenario: FlightScenarioId,
  timeS: number,
  motors: readonly FlightMotor[],
  massKg: number,
): FlightFrame {
  if (motors.length !== 4) throw new Error("Flight replay requires four motors.");
  if (!Number.isFinite(massKg) || massKg <= 0) throw new Error("Flight replay requires positive assembly mass.");
  const motorThrustN = profile(scenario, timeS, massKg * G / 4);
  const totalThrust = motorThrustN.reduce((sum, value) => sum + value, 0);
  let torqueX = 0;
  let torqueY = 0;
  let torqueZ = 0;
  motors.forEach((motor, index) => {
    const thrust = motorThrustN[index]!;
    torqueX += motor.centerM[1] * thrust;
    torqueY -= motor.centerM[0] * thrust;
    if (scenario === "yaw") torqueZ += thrust * (index % 2 === 0 ? 1 : -1) * 0.012;
  });
  const phase = wave(timeS);
  const attitudeRad: Point = scenario === "roll" ? [phase * 0.34, 0, 0]
    : scenario === "pitch" ? [0, phase * 0.3, 0]
      : scenario === "yaw" ? [0, 0, phase * 0.24] : [0, 0, 0];
  return {
    scenario,
    timeS,
    motorThrustN: Object.freeze(motorThrustN),
    resultantForceN: [0, 0, totalThrust],
    resultantTorqueNm: [torqueX, torqueY, torqueZ],
    linearAccelerationMps2: [0, 0, totalThrust / massKg - G],
    attitudeRad,
    loadFactorG: totalThrust / (massKg * G),
  };
}
