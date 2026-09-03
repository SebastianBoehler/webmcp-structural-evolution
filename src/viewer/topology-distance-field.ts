import type { GridDimensions, Vector3Tuple } from "./field-instances";

interface QueueEntry {
  readonly distance: number;
  readonly index: number;
}

interface NeighborStep {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly distance: number;
}

class DistanceQueue {
  private readonly entries: QueueEntry[] = [];

  push(entry: QueueEntry): void {
    const { entries } = this;
    entries.push(entry);
    let child = entries.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.precedes(entries[parent]!, entry)) break;
      entries[child] = entries[parent]!;
      child = parent;
    }
    entries[child] = entry;
  }

  pop(): QueueEntry | undefined {
    const { entries } = this;
    const first = entries[0];
    const last = entries.pop();
    if (!first || !last || entries.length === 0) return first;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let child = left;
      if (right < entries.length && this.precedes(entries[right]!, entries[left]!)) child = right;
      if (child >= entries.length || this.precedes(last, entries[child]!)) break;
      entries[parent] = entries[child]!;
      parent = child;
    }
    entries[parent] = last;
    return first;
  }

  private precedes(left: QueueEntry, right: QueueEntry): boolean {
    return left.distance < right.distance || (left.distance === right.distance && left.index <= right.index);
  }
}

function gridVolume(dimensions: GridDimensions): number {
  const { width, height, depth } = dimensions;
  if (![width, height, depth].every((value) => Number.isInteger(value) && value > 0)) {
    throw new RangeError("Topology distance-field dimensions must be positive integers.");
  }
  const volume = width * height * depth;
  if (!Number.isSafeInteger(volume)) throw new RangeError("Topology distance-field grid is too large.");
  return volume;
}

function validateInput(
  density: Float32Array,
  dimensions: GridDimensions,
  cellSize: Vector3Tuple,
  densityIsolation: number,
): void {
  const volume = gridVolume(dimensions);
  if (!(density instanceof Float32Array) || density.length !== volume) {
    throw new RangeError("Topology distance-field density does not match the topology grid.");
  }
  if (!Array.isArray(cellSize) || cellSize.length !== 3 || cellSize.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("Topology distance-field cell size must contain three positive finite values.");
  }
  if (!Number.isFinite(densityIsolation)) throw new RangeError("Topology density isolation must be finite.");
  for (const value of density) {
    if (!Number.isFinite(value)) throw new RangeError("Topology distance-field density must be finite.");
  }
}

function neighborSteps(cellSize: Vector3Tuple): readonly NeighborStep[] {
  const steps: NeighborStep[] = [];
  for (let z = -1; z <= 1; z += 1) for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) {
    if (x === 0 && y === 0 && z === 0) continue;
    steps.push({
      x, y, z,
      distance: Math.hypot(x * cellSize[0], y * cellSize[1], z * cellSize[2]),
    });
  }
  return steps;
}

function distancesTo(
  density: Float32Array,
  dimensions: GridDimensions,
  steps: readonly NeighborStep[],
  densityIsolation: number,
  material: boolean,
): Float64Array {
  const { width, height, depth } = dimensions;
  const distances = new Float64Array(density.length).fill(Infinity);
  const queue = new DistanceQueue();
  for (let index = 0; index < density.length; index += 1) {
    if ((density[index]! >= densityIsolation) === material) {
      distances[index] = 0;
      queue.push({ distance: 0, index });
    }
  }
  while (true) {
    const entry = queue.pop();
    if (!entry) return distances;
    if (entry.distance !== distances[entry.index]) continue;
    const x = entry.index % width;
    const y = Math.floor(entry.index / width) % height;
    const z = Math.floor(entry.index / (width * height));
    for (const step of steps) {
      const nextX = x + step.x;
      const nextY = y + step.y;
      const nextZ = z + step.z;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height || nextZ < 0 || nextZ >= depth) continue;
      const next = nextX + width * (nextY + height * nextZ);
      const candidate = entry.distance + step.distance;
      if (candidate < distances[next]) {
        distances[next] = candidate;
        queue.push({ distance: candidate, index: next });
      }
    }
  }
}

export function buildTopologyDistanceField(
  density: Float32Array,
  dimensions: GridDimensions,
  cellSize: Vector3Tuple,
  densityIsolation: number,
): Float32Array {
  validateInput(density, dimensions, cellSize, densityIsolation);
  const materialCount = density.reduce((count, value) => count + Number(value >= densityIsolation), 0);
  if (materialCount === 0 || materialCount === density.length) {
    throw new Error("Topology distance field requires both material and void cells.");
  }
  const steps = neighborSteps(cellSize);
  const distanceToMaterial = distancesTo(density, dimensions, steps, densityIsolation, true);
  const distanceToVoid = distancesTo(density, dimensions, steps, densityIsolation, false);
  const field = new Float32Array(density.length);
  const radius = 4 * Math.min(...cellSize);
  for (let index = 0; index < field.length; index += 1) {
    const signedDistance = distanceToVoid[index]! - distanceToMaterial[index]!;
    field[index] = Math.max(0, Math.min(1, 0.5 + signedDistance / radius));
  }
  return field;
}
