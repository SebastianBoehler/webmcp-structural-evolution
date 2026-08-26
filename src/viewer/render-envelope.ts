import type { AlternativeLayer } from "./alternative-instances";
import {
  assertFiniteF32,
  fieldInstanceCount,
  type InstanceRecord,
  type QuaternionTuple,
  type Vector3Tuple,
  type VoxelGrid,
} from "./field-instances";

// Assembly coordinates use study units (millimetres in the foundation study).
// One million units is a deliberately conservative engineering-viewer world bound.
export const MAX_RENDER_COORDINATE = 1_000_000;
const INSTANCE_SCALE = Math.fround(0.94);
const ZERO_OFFSET = [0, 0, 0] as const;

export interface ViewerRenderModel {
  readonly grid: VoxelGrid;
  readonly currentInstances: readonly InstanceRecord[];
  readonly alternativeLayers: readonly AlternativeLayer[];
}

export interface CameraEnvelope {
  readonly target: Vector3Tuple;
  readonly position: Vector3Tuple;
  readonly span: number;
  readonly near: number;
  readonly far: number;
}

export interface PreparedRenderModel extends ViewerRenderModel {
  readonly camera: CameraEnvelope;
}

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

function packed(value: number, label: string): number {
  assertFiniteF32(value, label);
  return Math.fround(value);
}

function bounded(value: number, label: string): number {
  const result = packed(value, label);
  if (Math.abs(result) > MAX_RENDER_COORDINATE) {
    throw new RangeError(`${label} exceeds the ${MAX_RENDER_COORDINATE}-unit world envelope`);
  }
  return result;
}

function f32Add(left: number, right: number, label: string): number {
  return packed(Math.fround(left) + Math.fround(right), label);
}

function f32Multiply(left: number, right: number, label: string): number {
  return packed(Math.fround(left) * Math.fround(right), label);
}

function normalizeGrid(grid: VoxelGrid): VoxelGrid {
  fieldInstanceCount(grid);
  const length = Math.hypot(...grid.anchor.orientation);
  const orientation = grid.anchor.orientation.map((value, axis) => {
    const normalized = value / length;
    assertFiniteF32(normalized, `normalized orientation[${axis}]`);
    return normalized;
  }) as unknown as QuaternionTuple;
  return Object.freeze({
    ...grid,
    anchor: Object.freeze({ ...grid.anchor, orientation: Object.freeze(orientation) }),
  });
}

function rotationMatrix(orientation: QuaternionTuple): readonly number[] {
  const [x, y, z, w] = orientation;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  ].map((value, index) => packed(value, `rotation coefficient[${index}]`));
}

function translation(grid: VoxelGrid, offset: readonly number[], label: string): Vector3Tuple {
  if (!Array.isArray(offset) || offset.length !== 3) {
    throw new RangeError(`${label} offset must contain exactly 3 values`);
  }
  return Object.freeze(grid.anchor.position.map((value, axis) => {
    bounded(offset[axis]!, `${label} offset[${axis}]`);
    return bounded(
      f32Add(value, offset[axis]!, `${label} translation[${axis}]`),
      `${label} translation[${axis}]`,
    );
  }) as unknown as Vector3Tuple);
}

function includeInstances(
  records: readonly InstanceRecord[],
  grid: VoxelGrid,
  offset: readonly number[],
  bounds: Bounds,
  label: string,
): void {
  const matrix = rotationMatrix(grid.anchor.orientation);
  const meshTranslation = translation(grid, offset, label);
  const half = grid.cellSize.map((size, axis) => bounded(
    f32Multiply(size / 2, INSTANCE_SCALE, `${label} half extent[${axis}]`),
    `${label} half extent[${axis}]`,
  ));
  records.forEach((record, recordIndex) => {
    if (!Array.isArray(record.localPosition) || record.localPosition.length !== 3) {
      throw new RangeError(`${label} instance[${recordIndex}] local position must contain exactly 3 values`);
    }
    const maxLocal = record.localPosition.map((value, axis) => {
      const center = bounded(value, `${label} instance[${recordIndex}] local position[${axis}]`);
      const low = bounded(
        f32Add(center, -half[axis]!, `${label} local corner low[${axis}]`),
        `${label} local corner low[${axis}]`,
      );
      const high = bounded(
        f32Add(center, half[axis]!, `${label} local corner high[${axis}]`),
        `${label} local corner high[${axis}]`,
      );
      return Math.max(Math.abs(low), Math.abs(high));
    });
    for (let worldAxis = 0; worldAxis < 3; worldAxis += 1) {
      let cornerReach = Math.abs(meshTranslation[worldAxis]!);
      let center = meshTranslation[worldAxis]!;
      let radius = 0;
      for (let localAxis = 0; localAxis < 3; localAxis += 1) {
        const coefficient = matrix[worldAxis * 3 + localAxis]!;
        const term = Math.abs(f32Multiply(
          coefficient,
          maxLocal[localAxis]!,
          `${label} corner term`,
        ));
        cornerReach = bounded(
          f32Add(cornerReach, term, `${label} corner reach`),
          `${label} corner reach`,
        );
        center = bounded(f32Add(
          center,
          f32Multiply(
            coefficient,
            record.localPosition[localAxis]!,
            `${label} center term`,
          ),
          `${label} world center`,
        ), `${label} world center`);
        radius = bounded(f32Add(
          radius,
          Math.abs(f32Multiply(
            coefficient,
            half[localAxis]!,
            `${label} radius term`,
          )),
          `${label} world radius`,
        ), `${label} world radius`);
      }
      const minimum = bounded(
        f32Add(center, -radius, `${label} world minimum`),
        `${label} world minimum`,
      );
      const maximum = bounded(
        f32Add(center, radius, `${label} world maximum`),
        `${label} world maximum`,
      );
      bounds.min[worldAxis] = Math.min(bounds.min[worldAxis], minimum);
      bounds.max[worldAxis] = Math.max(bounds.max[worldAxis], maximum);
    }
  });
}

function cameraFor(grid: VoxelGrid, bounds: Bounds): CameraEnvelope {
  const ranges = bounds.max.map((maximum, axis) => maximum - bounds.min[axis]!);
  const span = bounded(Math.max(1, ...ranges, ...grid.cellSize), "camera span");
  const target = Object.freeze(grid.anchor.position.map((value, axis) =>
    bounded(value, `camera target[${axis}]`),
  )) as Vector3Tuple;
  const position = Object.freeze([1.4, 1, 1.8].map((factor, axis) => bounded(
    f32Add(
      target[axis]!,
      f32Multiply(span, factor, `camera offset[${axis}]`),
      `camera position[${axis}]`,
    ),
    `camera position[${axis}]`,
  ))) as Vector3Tuple;
  return Object.freeze({
    target,
    position,
    span,
    near: bounded(Math.max(0.01, span / 1000), "camera near plane"),
    far: bounded(Math.max(1, span * 20), "camera far plane"),
  });
}

export function prepareRenderModel(model: ViewerRenderModel): PreparedRenderModel {
  const grid = normalizeGrid(model.grid);
  const anchor = grid.anchor.position;
  const bounds: Bounds = { min: [...anchor], max: [...anchor] };
  includeInstances(model.currentInstances, grid, ZERO_OFFSET, bounds, "current");
  const layers = model.alternativeLayers.map((layer, index) => {
    const layerGrid = normalizeGrid(layer.grid);
    const prefix = `alternative[${index}]`;
    includeInstances(layer.added, layerGrid, layer.displayOffset, bounds, `${prefix} added`);
    includeInstances(layer.removed, layerGrid, layer.displayOffset, bounds, `${prefix} removed`);
    includeInstances(layer.auditionInstances, layerGrid, ZERO_OFFSET, bounds, `${prefix} audition`);
    return Object.freeze({ ...layer, grid: layerGrid });
  });
  return Object.freeze({
    grid,
    currentInstances: model.currentInstances,
    alternativeLayers: Object.freeze(layers),
    camera: cameraFor(grid, bounds),
  });
}
