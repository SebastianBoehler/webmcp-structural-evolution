import type { VoxelGrid } from "../viewer/field-instances";

type Point = readonly [number, number, number];
type Tensor3 = readonly [Point, Point, Point];

export interface SolverVolume {
  readonly kind: "box" | "cylinder";
  readonly centerM: Point;
  readonly sizeM?: Point;
  readonly radiusM?: number;
  readonly heightM?: number;
  readonly yawRad: number;
}

export interface LoadPathGuide {
  readonly id: string;
  readonly kind: "must-pass";
  readonly pointsM: readonly Point[];
  readonly memberWidthM: number;
  readonly frameThicknessM: number;
}

export interface SolverLoad {
  readonly region: SolverVolume;
  readonly forceN: Point;
}

export interface SolverLoadCase {
  readonly id: string;
  readonly loads: readonly SolverLoad[];
}

export interface AssemblyTopologyInput {
  readonly grid: { readonly dimensions: { readonly width: number; readonly height: number; readonly depth: number }; readonly originM: Point; readonly cellSizeM: Point };
  readonly designDomain: readonly SolverVolume[];
  readonly loadCases: readonly SolverLoadCase[];
  /** Legacy viewport annotations; the solver consumes loadCases. */
  readonly motorMounts: readonly { readonly centerM: Point; readonly radiusM: number; readonly loadN: Point }[];
  readonly supports: readonly SolverVolume[];
  readonly requiredSolids: readonly SolverVolume[];
  readonly protectedVoids: readonly SolverVolume[];
  readonly accessVoids: readonly SolverVolume[];
  readonly loadPathGuides: readonly LoadPathGuide[];
  readonly material: { readonly youngsModulusPa: number; readonly failureStressPa: number };
  readonly minimumFeatureM: number;
  readonly minimumLoadPathWidthM: number;
  readonly minimumFrameThicknessM: number;
  readonly inertialRelief: boolean;
  readonly assemblyMassKg: number;
  readonly centerOfMassM: Point;
  readonly inertialMasses: readonly {
    readonly id: string;
    readonly centerM: Point;
    readonly massKg: number;
    readonly inertiaTensorKgM2: Tensor3;
  }[];
}

export interface LiveTopologyContext {
  readonly input: AssemblyTopologyInput;
  readonly grid: VoxelGrid;
}
