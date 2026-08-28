import type { ComponentDefinition } from "../domain/component-model";
import type { SolverVolume } from "./assembly-topology-input";

type Point = readonly [number, number, number];
type Grid = Readonly<{
  dimensions: Readonly<{ width: number; height: number; depth: number }>;
  cellSizeM: Point;
}>;

const metres = (value: { readonly value: number; readonly unit: "m" | "mm" }) =>
  value.unit === "m" ? value.value : value.value / 1_000;
const point = (value: ComponentDefinition["centerOfMass"]): Point =>
  [metres(value.x), metres(value.y), metres(value.z)];
const add = (left: Point, right: Point): Point =>
  [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
const rotateZ = ([x, y, z]: Point, yaw: number): Point =>
  [Math.cos(yaw) * x - Math.sin(yaw) * y, Math.sin(yaw) * x + Math.cos(yaw) * y, z];

export function componentMountAccessVoids(
  definition: ComponentDefinition,
  centerM: Point,
  yawRad: number,
  grid: Grid,
  occupiedLocations: Set<string>,
): readonly SolverVolume[] {
  if (!["flight-controller-30x30", "esc-30x30", "video-transmitter"].includes(definition.id)) return [];
  return definition.mountInterfaces.flatMap((mount) => {
    const worldMount = add(centerM, rotateZ(point(mount.position), yawRad));
    const key = `${worldMount[0].toFixed(9)}:${worldMount[1].toFixed(9)}`;
    if (occupiedLocations.has(key)) return [];
    occupiedLocations.add(key);
    return [{
      kind: "cylinder" as const,
      centerM: [worldMount[0], worldMount[1], 0] as Point,
      radiusM: Math.max(metres(mount.diameter) / 2, grid.cellSizeM[0] * 1.5),
      heightM: grid.cellSizeM[2] * grid.dimensions.depth,
      yawRad,
    }];
  });
}

export function componentFixtureVolumes(
  definition: ComponentDefinition,
  centerM: Point,
  yawRad: number,
): Readonly<{ solids: readonly SolverVolume[]; access: readonly SolverVolume[] }> {
  if (definition.category === "battery") return {
    solids: [{ kind: "box", centerM: [centerM[0], centerM[1], -0.0015], sizeM: [0.084, 0.060, 0.003], yawRad }],
    access: [],
  };
  if (definition.id === "fpv-camera") {
    const solids: SolverVolume[] = [{
      kind: "box", centerM: add(centerM, rotateZ([-0.038, 0, -0.004], yawRad)), sizeM: [0.008, 0.030, 0.020], yawRad,
    }];
    const access: SolverVolume[] = [];
    for (const side of [-1, 1]) {
      solids.push({ kind: "box", centerM: add(centerM, rotateZ([-0.019, side * 0.0135, -0.004], yawRad)), sizeM: [0.046, 0.003, 0.020], yawRad });
      access.push({ kind: "box", centerM: add(centerM, rotateZ([0, side * 0.0135, 0], yawRad)), sizeM: [0.006, 0.006, 0.006], yawRad });
    }
    return { solids, access };
  }
  if (definition.id === "video-transmitter") return {
    solids: [{ kind: "box", centerM: [centerM[0], centerM[1], -0.0015], sizeM: [0.036, 0.036, 0.003], yawRad }], access: [],
  };
  if (definition.id === "radio-receiver") {
    const solids: SolverVolume[] = [-1, 1].map((side) => ({
      kind: "box", centerM: add(centerM, rotateZ([0, side * 0.009, 0], yawRad)), sizeM: [0.021, 0.003, 0.008], yawRad,
    }));
    solids.push({ kind: "box", centerM: add(centerM, rotateZ([0, 0, -0.004], yawRad)), sizeM: [0.021, 0.021, 0.001], yawRad });
    return { solids, access: [] };
  }
  if (definition.id === "video-antenna") {
    const mate = definition.interfaces.find(({ id }) => id === "frame-antenna-clip");
    if (!mate) throw new Error("Video antenna clip interface is missing.");
    const clip = point(mate.position);
    const solids: SolverVolume[] = [-1, 1].map((side) => ({
      kind: "box", centerM: add(centerM, rotateZ([clip[0], side * 0.009, -0.00375], yawRad)), sizeM: [0.012, 0.003, 0.0075], yawRad,
    }));
    solids.push({ kind: "box", centerM: add(centerM, rotateZ([clip[0], 0, -0.0075], yawRad)), sizeM: [0.012, 0.021, 0.001], yawRad });
    return { solids, access: [] };
  }
  return { solids: [], access: [] };
}
