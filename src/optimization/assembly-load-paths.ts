import type { AssemblyTopologyInput, LoadPathGuide, SolverVolume } from "./assembly-topology-input";

type Point = readonly [number, number, number];

export function branchingLoadPaths(
  motors: AssemblyTopologyInput["motorMounts"],
  support: SolverVolume,
): readonly LoadPathGuide[] {
  const frame = support.centerM;
  return motors.flatMap((motor, motorIndex) => {
    const delta = [motor.centerM[0] - frame[0], motor.centerM[1] - frame[1]] as const;
    const length = Math.hypot(...delta);
    if (length <= 0) throw new Error("A motor mount cannot coincide with the body support.");
    const radial = [delta[0] / length, delta[1] / length] as const;
    const tangent = [-radial[1], radial[0]] as const;
    return [-1, 1].flatMap((side) => ["lower", "upper"].map((level): LoadPathGuide => {
      const at = (radialDistance: number, tangentDistance: number, z: number): Point => [
        frame[0] + radial[0] * radialDistance + tangent[0] * tangentDistance * side,
        frame[1] + radial[1] * radialDistance + tangent[1] * tangentDistance * side,
        z,
      ];
      return {
        id: `motor-${motorIndex + 1}-${side < 0 ? "left" : "right"}-${level}`,
        kind: "must-pass",
        pointsM: [
          at(length, 0.006, motor.centerM[2]),
          at(Math.min(0.074, length * 0.72), 0.009, level === "upper" ? 0.009 : motor.centerM[2]),
          at(0.042, 0.017, level === "upper" ? 0.011 : motor.centerM[2]),
          at(0.010, 0.010, frame[2]),
        ],
        memberWidthM: 0.005,
        frameThicknessM: 0.005,
      };
    }));
  });
}
