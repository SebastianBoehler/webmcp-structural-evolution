import type { AssemblyAuthoringState } from "../assembly/assembly-authoring";
import { solveAssemblyConstraints } from "../assembly/assembly-authoring";
import type { ComponentDefinition } from "../domain/component-model";
import type { VoxelGrid } from "../viewer/field-instances";

type Point = readonly [number, number, number];

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

export interface AssemblyTopologyInput {
  readonly grid: { readonly dimensions: { readonly width: number; readonly height: number; readonly depth: number }; readonly originM: Point; readonly cellSizeM: Point };
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
  readonly assemblyMassKg: number;
  readonly centerOfMassM: Point;
}

export interface LiveTopologyContext {
  readonly input: AssemblyTopologyInput;
  readonly grid: VoxelGrid;
}

const metres = (value: { readonly value: number; readonly unit: "m" | "mm" }) => value.unit === "m" ? value.value : value.value / 1_000;
const point = (value: { readonly x: { readonly value: number; readonly unit: "m" | "mm" }; readonly y: { readonly value: number; readonly unit: "m" | "mm" }; readonly z: { readonly value: number; readonly unit: "m" | "mm" } }): Point => [metres(value.x), metres(value.y), metres(value.z)];
const add = (left: Point, right: Point): Point => [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
const rotateZ = ([x, y, z]: Point, yaw: number): Point => [Math.cos(yaw) * x - Math.sin(yaw) * y, Math.sin(yaw) * x + Math.cos(yaw) * y, z];

function definitionFor(state: AssemblyAuthoringState, revision: string): ComponentDefinition {
  const definition = state.catalog.find((candidate) => candidate.revision === revision);
  if (!definition) throw new Error(`Component revision is absent from the live assembly: ${revision}`);
  return definition;
}

function worldVolume(
  volume: ComponentDefinition["protectedVolumes"][number] | ComponentDefinition["collisionVolumes"][number],
  centerM: Point,
  yawRad: number,
): SolverVolume {
  const local = point(volume.center);
  const center = add(centerM, rotateZ(local, yawRad));
  if (volume.kind === "box") return {
    kind: "box", centerM: center, sizeM: point(volume.size), yawRad: yawRad + volume.orientation.yaw.value,
  };
  return {
    kind: "cylinder", centerM: center, radiusM: metres(volume.radius), heightM: metres(volume.height), yawRad: yawRad + volume.orientation.yaw.value,
  };
}

function dynamicGrid(state: AssemblyAuthoringState): AssemblyTopologyInput["grid"] {
  const envelope = state.draft.targetEnvelope;
  if (envelope.kind !== "box") throw new Error("The FPV topology solver requires the live box design envelope.");
  const center = point(envelope.center);
  const size = point(envelope.size);
  // 128 x 128 x 32 resolves the 5-inch assembly at 1.875 x 1.875 x 0.75 mm.
  const dimensions = { width: 128, height: 128, depth: 32 };
  const cellSizeM: Point = [size[0] / dimensions.width, size[1] / dimensions.height, size[2] / dimensions.depth];
  const originM: Point = [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2];
  return { dimensions, originM, cellSizeM };
}

function branchingLoadPaths(
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

export function compileLiveTopologyContext(state: AssemblyAuthoringState): LiveTopologyContext {
  const grid = dynamicGrid(state);
  const solved = solveAssemblyConstraints(state);
  const motorMounts: { centerM: Point; radiusM: number; loadN: Point }[] = [];
  const supports: SolverVolume[] = [];
  const requiredSolids: SolverVolume[] = [];
  const protectedVoids: SolverVolume[] = [];
  const accessVoids: SolverVolume[] = [];
  let assemblyMassKg = 0;
  const weightedCenter = [0, 0, 0];

  for (const instance of state.draft.components) {
    const definition = definitionFor(state, instance.componentRevision);
    const transform = solved.instances[instance.instanceId]?.transform;
    if (!transform) throw new Error(`Live transform is absent for ${instance.instanceId}.`);
    const centerM: Point = [transform.positionMm[0] / 1_000, transform.positionMm[1] / 1_000, transform.positionMm[2] / 1_000];
    const yawRad = transform.orientationRad[2];
    if (definition.massAccounting === "standalone") {
      const localCenter = point(definition.centerOfMass);
      const localAnchor = point(definition.anchor.position);
      const worldCenter = add(centerM, rotateZ([
        localCenter[0] - localAnchor[0],
        localCenter[1] - localAnchor[1],
        localCenter[2] - localAnchor[2],
      ], yawRad));
      assemblyMassKg += definition.mass.value;
      for (let axis = 0; axis < 3; axis += 1) weightedCenter[axis] += worldCenter[axis]! * definition.mass.value;
    }
    if (definition.category === "motor") {
      const mountRadiusM = Math.max(...definition.mountInterfaces.map(({ position }) => Math.hypot(metres(position.x), metres(position.y)))) + 0.004;
      const load = definition.loadContributions[0]?.force;
      const plateCenterM: Point = [centerM[0], centerM[1], centerM[2] - 0.003];
      motorMounts.push({
        centerM: plateCenterM, radiusM: mountRadiusM,
        loadN: [load?.x.value ?? 0, load?.y.value ?? 0, load?.z.value ?? -18],
      });
      for (const mount of definition.mountInterfaces) {
        const localCenter = point(mount.position);
        accessVoids.push({
          kind: "cylinder",
          centerM: add(plateCenterM, rotateZ(localCenter, yawRad)),
          // M3 cap-head radius plus 0.5 mm radial installation clearance.
          radiusM: metres(mount.diameter) / 2 + 0.00184,
          heightM: grid.cellSizeM[2] * grid.dimensions.depth,
          yawRad,
        });
      }
      // Motor bodies are kept clear above the mount; their fasteners are imported as real collision geometry below.
      protectedVoids.push(...definition.collisionVolumes.map((volume) => worldVolume(volume, centerM, yawRad)));
    } else if (definition.category === "body-interface") {
      // The body interface is the real fixture boundary for this frame slice, rather than an invented centre support.
      supports.push(...definition.collisionVolumes.map((volume) => worldVolume(volume, centerM, yawRad)));
    } else {
      if (definition.category === "battery") {
        requiredSolids.push({ kind: "box", centerM: [centerM[0], centerM[1], -0.0045], sizeM: [0.084, 0.050, 0.003], yawRad });
        for (const x of [-0.024, 0.024]) for (const y of [-0.0225, 0.0225]) {
          accessVoids.push({ kind: "box", centerM: [centerM[0] + x, centerM[1] + y, 0], sizeM: [0.014, 0.004, 0.024], yawRad });
        }
      }
      if (definition.id === "fpv-camera") {
        requiredSolids.push({ kind: "box", centerM: [centerM[0], centerM[1], 0], sizeM: [0.035, 0.030, 0.005], yawRad });
        for (const side of [-1, 1]) {
          const wallCenter = add(centerM, rotateZ([0, side * 0.0115, -0.004], yawRad));
          requiredSolids.push({ kind: "box", centerM: wallCenter, sizeM: [0.028, 0.003, 0.020], yawRad });
          accessVoids.push({ kind: "box", centerM: add(wallCenter, [0, 0, 0.004]), sizeM: [0.008, 0.005, 0.004], yawRad });
        }
      }
      protectedVoids.push(
        ...definition.collisionVolumes.map((volume) => worldVolume(volume, centerM, yawRad)),
        ...definition.protectedVolumes.map((volume) => worldVolume(volume, centerM, yawRad)),
      );
    }
  }
  if (motorMounts.length !== 4) throw new Error("The FPV reference solve requires exactly four live motor instances.");
  if (supports.length === 0) throw new Error("The FPV reference solve requires a live body-interface support volume.");
  if (assemblyMassKg <= 0) throw new Error("The FPV reference solve requires positive accounted assembly mass.");

  const centerOfMassM = weightedCenter.map((value) => value / assemblyMassKg) as unknown as Point;
  const loadPathGuides = branchingLoadPaths(motorMounts, supports[0]!);

  const input: AssemblyTopologyInput = {
    grid,
    motorMounts,
    supports,
    requiredSolids,
    protectedVoids,
    accessVoids,
    loadPathGuides,
    material: { youngsModulusPa: 3_500_000_000, failureStressPa: 50_000_000 },
    minimumFeatureM: 0.001,
    minimumLoadPathWidthM: 0.005,
    minimumFrameThicknessM: 0.005,
    assemblyMassKg,
    centerOfMassM,
  };
  return {
    input,
    grid: {
      dimensions: grid.dimensions,
      cellSize: grid.cellSizeM.map((value) => value * 1_000) as unknown as Point,
      anchor: { position: grid.originM.map((value) => value * 1_000) as unknown as Point, orientation: [0, 0, 0, 1] },
    },
  };
}
