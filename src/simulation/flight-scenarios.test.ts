import { describe, expect, it } from "vitest";

import { flightFrameAt, FLIGHT_SCENARIOS, structuralReplayScale,
  structuralReplayInterpolation, structuralReplaySignedScale } from "./flight-scenarios";

const motors = [
  { id: "motor-east", centerM: [0.105, 0, 0] as const },
  { id: "motor-north", centerM: [0, 0.105, 0] as const },
  { id: "motor-west", centerM: [-0.105, 0, 0] as const },
  { id: "motor-south", centerM: [0, -0.105, 0] as const },
];

describe("flight scenario replay", () => {
  it("keeps hover balanced while reporting the force and torque budget", () => {
    const frame = flightFrameAt("hover", 0.5, motors, 0.495);
    expect(frame.motorThrustN.every((force) => force > 0)).toBe(true);
    expect(frame.resultantForceN[0]).toBeCloseTo(0);
    expect(frame.resultantForceN[1]).toBeCloseTo(0);
    expect(frame.resultantTorqueNm[0]).toBeCloseTo(0);
    expect(frame.resultantTorqueNm[1]).toBeCloseTo(0);
    expect(frame.loadFactorG).toBeCloseTo(1, 2);
  });

  it("produces signed roll torque from differential thrust", () => {
    const frame = flightFrameAt("roll", 0.25, motors, 0.495);
    expect(Math.abs(frame.resultantTorqueNm[0])).toBeGreaterThan(0.05);
    expect(frame.motorThrustN[1]).not.toBeCloseTo(frame.motorThrustN[3]!);
  });

  it("renders yaw as tangential XY loads producing torque about Z", () => {
    const frame = flightFrameAt("yaw", 0.25, motors, 0.495);
    expect(Math.abs(frame.resultantTorqueNm[2])).toBeGreaterThan(0.01);
    frame.motorLoadVectorsN.forEach(([forceX, forceY, forceZ], index) => {
      const [motorX, motorY] = motors[index]!.centerM;
      expect(forceZ).toBeCloseTo(0);
      expect(motorX * forceX + motorY * forceY).toBeCloseTo(0, 8);
      expect(Math.hypot(forceX, forceY)).toBeGreaterThan(0);
    });
  });

  it("maps every optimizer load case to an explicit replay scenario", () => {
    expect(FLIGHT_SCENARIOS.map(({ solverCase }) => solverCase)).toEqual([
      "collective-thrust", "roll-differential", "pitch-differential", "yaw-torsion",
    ]);
  });

  it("scales structural cases from the instantaneous load relative to the solver reference", () => {
    const massKg = 0.495;
    const referenceMotorLoadN = 18;
    const hoverN = massKg * 9.80665 / 4;

    expect(structuralReplayScale(flightFrameAt("hover", 0, motors, massKg), referenceMotorLoadN))
      .toBeCloseTo(hoverN / referenceMotorLoadN, 12);
    expect(structuralReplayScale(flightFrameAt("roll", 0, motors, massKg), referenceMotorLoadN))
      .toBe(0);
    expect(structuralReplayScale(flightFrameAt("roll", 0.25, motors, massKg), referenceMotorLoadN))
      .toBeCloseTo(hoverN * 0.78 / (referenceMotorLoadN * 0.65), 12);
    expect(structuralReplayScale(flightFrameAt("yaw", 0.25, motors, massKg), referenceMotorLoadN))
      .toBeCloseTo(hoverN * 0.38 / (referenceMotorLoadN * 0.12), 12);
    expect(structuralReplaySignedScale(flightFrameAt("roll", 0.25, motors, massKg), referenceMotorLoadN))
      .toBeGreaterThan(0);
    expect(structuralReplaySignedScale(flightFrameAt("roll", 0.75, motors, massKg), referenceMotorLoadN))
      .toBeLessThan(0);
  });

  it("interpolates a visible signed cycle through each precomputed case", () => {
    expect(structuralReplayInterpolation(flightFrameAt("hover", 0.5, motors, 0.495))).toBe(1);
    expect(structuralReplayInterpolation(flightFrameAt("roll", 0, motors, 0.495))).toBeCloseTo(0);
    expect(structuralReplayInterpolation(flightFrameAt("roll", 0.25, motors, 0.495))).toBeCloseTo(1);
    expect(structuralReplayInterpolation(flightFrameAt("roll", 0.75, motors, 0.495))).toBeCloseTo(-1);
  });
});
