export const MAX_FIELD_INSTANCES = 64 ** 3;

export type Vector3Tuple = readonly [number, number, number];
export type QuaternionTuple = readonly [number, number, number, number];

export interface GridDimensions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface AssemblySpaceAnchor {
  readonly position: Vector3Tuple;
  readonly orientation: QuaternionTuple;
}

export interface VoxelGrid {
  readonly dimensions: GridDimensions;
  readonly cellSize: Vector3Tuple;
  readonly anchor: AssemblySpaceAnchor;
}

export interface InstanceRecord {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly localPosition: Vector3Tuple;
  readonly density: number;
}

function finiteTuple(values: readonly number[], name: string, positive = false): void {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value) || (positive && value <= 0)) {
      throw new RangeError(`${name}[${index}] must be ${positive ? "positive and " : ""}finite`);
    }
  }
}

export function fieldInstanceCount(grid: VoxelGrid): number {
  const axes = Object.entries(grid.dimensions) as [keyof GridDimensions, number][];
  for (const [axis, value] of axes) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`grid dimensions.${axis} must be a positive integer`);
    }
  }

  finiteTuple(grid.cellSize, "grid cellSize", true);
  finiteTuple(grid.anchor.position, "grid anchor position");
  finiteTuple(grid.anchor.orientation, "grid anchor orientation");
  if (grid.anchor.orientation.every((value) => value === 0)) {
    throw new RangeError("grid anchor orientation must be a non-zero quaternion");
  }

  const count = grid.dimensions.width * grid.dimensions.height * grid.dimensions.depth;
  if (!Number.isSafeInteger(count) || count > MAX_FIELD_INSTANCES) {
    throw new RangeError(`grid exceeds the ${MAX_FIELD_INSTANCES} instance budget`);
  }
  return count;
}

export function instanceAt(field: Float32Array, grid: VoxelGrid, index: number): InstanceRecord {
  const { width, height } = grid.dimensions;
  const x = index % width;
  const y = Math.floor(index / width) % height;
  const z = Math.floor(index / (width * height));
  const record: InstanceRecord = {
    index,
    x,
    y,
    z,
    localPosition: Object.freeze([
      (x + 0.5) * grid.cellSize[0],
      (y + 0.5) * grid.cellSize[1],
      (z + 0.5) * grid.cellSize[2],
    ]),
    density: field[index]!,
  };
  return Object.freeze(record);
}

export function validateField(field: Float32Array, grid: VoxelGrid): number {
  const count = fieldInstanceCount(grid);
  if (!(field instanceof Float32Array)) {
    throw new TypeError("field must be a Float32Array");
  }
  if (field.length !== count) {
    throw new RangeError(`field length must equal grid volume (${count})`);
  }
  for (let index = 0; index < field.length; index += 1) {
    if (!Number.isFinite(field[index])) {
      throw new RangeError(`field[${index}] must be finite`);
    }
  }
  return count;
}

export function visibleInstances(
  field: Float32Array,
  grid: VoxelGrid,
  threshold: number,
): readonly InstanceRecord[] {
  if (!Number.isFinite(threshold)) {
    throw new RangeError("threshold must be finite");
  }
  const count = validateField(field, grid);
  const visibleCount = field.reduce((total, value) => total + Number(value >= threshold), 0);
  const records = new Array<InstanceRecord>(visibleCount);
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    if (field[index]! >= threshold) records[cursor++] = instanceAt(field, grid, index);
  }
  return Object.freeze(records);
}
