import type { StructuralVoxelPayload } from "./structural-contract";

export function dimensions(payload: StructuralVoxelPayload): readonly [number, number, number] {
  if (payload.dimensions.length !== 3 || [...payload.dimensions].some((value) => value < 1)) {
    throw new Error("Structural voxel dimensions must contain three positive integers");
  }
  return [payload.dimensions[0]!, payload.dimensions[1]!, payload.dimensions[2]!];
}

export function uniformCellSize(payload: StructuralVoxelPayload): number {
  if (payload.cellSizeM.length !== 3 || [...payload.cellSizeM].some((value) => !Number.isFinite(value) || value <= 0)
    || payload.cellSizeM.some((value) => Math.abs(value - payload.cellSizeM[0]!) > payload.cellSizeM[0]! * 1e-12)) {
    throw new Error("Structural adapter supports only finite uniform cubic cells");
  }
  return payload.cellSizeM[0]!;
}

export function origin(payload: StructuralVoxelPayload): readonly [number, number, number] {
  if (payload.originM.length !== 3 || [...payload.originM].some((value) => !Number.isFinite(value))) {
    throw new Error("Structural voxel origin must contain three finite SI coordinates");
  }
  return [payload.originM[0]!, payload.originM[1]!, payload.originM[2]!];
}

export function activeCells(payload: StructuralVoxelPayload, cellCount: number): Uint32Array {
  if (payload.activeCells.length !== cellCount
    || payload.activeCells.some((value) => value !== 0 && value !== 1)) {
    throw new Error("Structural active-cell mask must contain one binary value per grid cell");
  }
  const copy = new Uint32Array(payload.activeCells);
  if (!copy.some(Boolean)) throw new Error("Structural voxel domain contains no active cells");
  return copy;
}

function neighboringCells(index: number, dims: readonly [number, number, number]): number[] {
  const [width, height, depth] = dims;
  const plane = width * height;
  const z = Math.floor(index / plane);
  const rest = index - z * plane;
  const y = Math.floor(rest / width);
  const x = rest - y * width;
  const result: number[] = [];
  if (x > 0) result.push(index - 1);
  if (x + 1 < width) result.push(index + 1);
  if (y > 0) result.push(index - width);
  if (y + 1 < height) result.push(index + width);
  if (z > 0) result.push(index - plane);
  if (z + 1 < depth) result.push(index + plane);
  return result;
}

export function activeComponents(
  mask: Uint32Array,
  dims: readonly [number, number, number],
): Int32Array {
  const components = new Int32Array(mask.length).fill(-1);
  let component = 0;
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || components[seed] !== -1) continue;
    const queue = [seed];
    components[seed] = component;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const neighbor of neighboringCells(queue[cursor]!, dims)) {
        if (mask[neighbor] && components[neighbor] === -1) {
          components[neighbor] = component;
          queue.push(neighbor);
        }
      }
    }
    component += 1;
  }
  return components;
}
