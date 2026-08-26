import { describe, expect, it } from "vitest";

import { flightFrameAt, FLIGHT_SCENARIOS } from "./flight-scenarios";

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

  it("maps every optimizer load case to an explicit replay scenario", () => {
    expect(FLIGHT_SCENARIOS.map(({ solverCase }) => solverCase)).toEqual([
      "collective-thrust", "roll-differential", "pitch-differential", "yaw-torsion",
    ]);
  });
});
