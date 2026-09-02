import {
  topologyMinimumFeatureCellWidth, type TopologyCellDimensions,
} from "./minimum-feature";

type BinaryMask = Uint8Array | Uint32Array;

export interface TopologyMinimumFeatureLocalTracker {
  isOffender(mask: BinaryMask, cell: number): boolean;
  affectedOffenders(mask: BinaryMask, changedCell: number): Uint32Array;
}

export function createTopologyMinimumFeatureLocalTracker(
  dimensions: TopologyCellDimensions,
  minimumFeatureM: number,
  cellSizeM: number,
  maskLength: number,
): TopologyMinimumFeatureLocalTracker {
  const [width, height, depth] = dimensions, plane = width * height;
  if (dimensions.some((value) => !Number.isInteger(value) || value < 1)
    || maskLength !== width * height * depth) {
    throw new Error("Topology local minimum-feature dimensions are invalid");
  }
  const minimumCells = topologyMinimumFeatureCellWidth(minimumFeatureM, cellSizeM);
  const coordinates = (cell: number) => {
    const z = Math.floor(cell / plane), rest = cell - z * plane;
    const y = Math.floor(rest / width), x = rest - y * width;
    return [x, y, z] as [number, number, number];
  };
  const index = (point: readonly number[]) => point[0]! + width * (point[1]! + height * point[2]!);
  const run = (mask: BinaryMask, cell: number, axis: number) => {
    const point = coordinates(cell); let length = 1;
    for (const direction of [-1, 1]) for (let step = 1; ; step += 1) {
      const next = [...point]; next[axis] += direction * step;
      if (next[axis]! < 0 || next[axis]! >= dimensions[axis]!
        || mask[index(next)] !== 1) break;
      length += 1;
    }
    return length;
  };
  const isOffender = (mask: BinaryMask, cell: number) => mask[cell] === 1
    && [0, 1, 2].some((axis) => run(mask, cell, axis) < minimumCells);
  return {
    isOffender,
    affectedOffenders(mask, changedCell) {
      if (!Number.isInteger(changedCell) || changedCell < 0 || changedCell >= maskLength) {
        throw new Error("Topology local minimum-feature cell is invalid");
      }
      const origin = coordinates(changedCell), seen = new Uint8Array(maskLength);
      const offenders: number[] = [];
      for (const axis of [0, 1, 2]) for (let value = 0; value < dimensions[axis]!; value += 1) {
        const point = [...origin]; point[axis] = value;
        const cell = index(point);
        if (seen[cell] === 0 && isOffender(mask, cell)) {
          seen[cell] = 1; offenders.push(cell);
        }
      }
      return Uint32Array.from(offenders.sort((left, right) => left - right));
    },
  };
}
