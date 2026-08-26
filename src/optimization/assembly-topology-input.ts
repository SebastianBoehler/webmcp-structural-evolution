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

export interface AssemblyTopologyInput {
  readonly grid: { readonly dimensions: { readonly width: number; readonly height: number; readonly depth: number }; readonly originM: Point; readonly cellSizeM: Point };
  readonly motorMounts: readonly { readonly centerM: Point; readonly radiusM: number; readonly loadN: Point }[];
  readonly supports: readonly SolverVolume[];
  readonly protectedVoids: readonly SolverVolume[];
  readonly material: { readonly youngsModulusPa: number; readonly failureStressPa: number };
  readonly minimumFeatureM: number;
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
  // 48 x 48 x 12 is a 27,648-cell physical solve at 5 x 5 x 2 mm, not a smoothed 25 x 25 x 5 field.
  const dimensions = { width: 48, height: 48, depth: 12 };
  const cellSizeM: Point = [size[0] / dimensions.width, size[1] / dimensions.height, size[2] / dimensions.depth];
  const originM: Point = [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2];
  return { dimensions, originM, cellSizeM };
}

export function compileLiveTopologyContext(state: AssemblyAuthoringState): LiveTopologyContext {
  const grid = dynamicGrid(state);
  const solved = solveAssemblyConstraints(state);
  const motorMounts: { centerM: Point; radiusM: number; loadN: Point }[] = [];
  const supports: SolverVolume[] = [];
  const protectedVoids: SolverVolume[] = [];

  for (const instance of state.draft.components) {
    const definition = definitionFor(state, instance.componentRevision);
    const transform = solved.instances[instance.instanceId]?.transform;
    if (!transform) throw new Error(`Live transform is absent for ${instance.instanceId}.`);
    const centerM: Point = [transform.positionMm[0] / 1_000, transform.positionMm[1] / 1_000, transform.positionMm[2] / 1_000];
    const yawRad = transform.orientationRad[2];
    if (definition.category === "motor") {
      const mountRadiusM = Math.max(...definition.mountInterfaces.map(({ position }) => Math.hypot(metres(position.x), metres(position.y)))) + 0.004;
      const load = definition.loadContributions[0]?.force;
      motorMounts.push({
        centerM, radiusM: mountRadiusM,
        loadN: [load?.x.value ?? 0, load?.y.value ?? 0, load?.z.value ?? -18],
      });
      // Motor bodies are kept clear above the mount; their fasteners are imported as real collision geometry below.
      protectedVoids.push(...definition.collisionVolumes.map((volume) => worldVolume(volume, centerM, yawRad)));
    } else if (definition.category === "body-interface") {
      // The body interface is the real fixture boundary for this frame slice, rather than an invented centre support.
      supports.push(...definition.collisionVolumes.map((volume) => worldVolume(volume, centerM, yawRad)));
    } else {
      protectedVoids.push(
        ...definition.collisionVolumes.map((volume) => worldVolume(volume, centerM, yawRad)),
        ...definition.protectedVolumes.map((volume) => worldVolume(volume, centerM, yawRad)),
      );
    }
  }
  if (motorMounts.length !== 4) throw new Error("The FPV reference solve requires exactly four live motor instances.");
  if (supports.length === 0) throw new Error("The FPV reference solve requires a live body-interface support volume.");

  const input: AssemblyTopologyInput = {
    grid,
    motorMounts,
    supports,
    protectedVoids,
    material: { youngsModulusPa: 3_500_000_000, failureStressPa: 50_000_000 },
    minimumFeatureM: 0.002,
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
