import { branchingLoadPaths } from "./assembly-load-paths";
import type { LoadPathGuide, SolverLoad, SolverLoadCase, SolverVolume } from "./assembly-topology-input";

type Point = readonly [number, number, number];
type MotorMount = Readonly<{ centerM: Point; radiusM: number; loadN: Point }>;

export interface ReferenceDroneStudyFields {
  readonly designDomain: readonly SolverVolume[];
  readonly loadCases: readonly SolverLoadCase[];
  readonly loadPathGuides: readonly LoadPathGuide[];
}

export function referenceDroneStudyFields(
  motorMounts: readonly MotorMount[],
  support: SolverVolume,
): ReferenceDroneStudyFields {
  const loadRegion = (motor: MotorMount): SolverVolume => ({
    kind: "cylinder", centerM: motor.centerM, radiusM: motor.radiusM,
    heightM: 0.005, yawRad: 0,
  });
  const loads = (force: (motor: MotorMount) => Point): SolverLoad[] =>
    motorMounts.map((motor) => ({ region: loadRegion(motor), forceN: force(motor) }));
  const designDomain: SolverVolume[] = [
    { kind: "cylinder", centerM: support.centerM, radiusM: 0.046, heightM: 0.022, yawRad: 0 },
    ...motorMounts.map((motor): SolverVolume => {
      const dx = motor.centerM[0] - support.centerM[0];
      const dy = motor.centerM[1] - support.centerM[1];
      return {
        kind: "box",
        centerM: [support.centerM[0] + dx / 2, support.centerM[1] + dy / 2, support.centerM[2]],
        sizeM: [Math.hypot(dx, dy), 0.044, 0.022],
        yawRad: Math.atan2(dy, dx),
      };
    }),
  ];
  const differential = (motor: MotorMount, axis: 0 | 1) =>
    motor.loadN.map((value) => value * (motor.centerM[axis] >= support.centerM[axis] ? 0.65 : -0.65)) as unknown as Point;
  const loadCases: SolverLoadCase[] = [
    { id: "hover", loads: loads((motor) => motor.loadN) },
    { id: "roll-differential", loads: loads((motor) => differential(motor, 1)) },
    { id: "pitch-differential", loads: loads((motor) => differential(motor, 0)) },
    { id: "yaw-torsion", loads: loads((motor) => {
      const dx = motor.centerM[0] - support.centerM[0];
      const dy = motor.centerM[1] - support.centerM[1];
      const radius = Math.max(Math.hypot(dx, dy), 1e-6);
      const tangential = Math.abs(motor.loadN[2]) * 0.12;
      return [-dy / radius * tangential, dx / radius * tangential, 0];
    }) },
  ];
  return { designDomain, loadCases, loadPathGuides: branchingLoadPaths(motorMounts, support) };
}
