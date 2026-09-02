export type TopologyCellDimensions = readonly [number, number, number];
type BinaryMask = Uint8Array | Uint32Array;

export function topologyMinimumFeatureCellWidth(
  minimumFeatureM: number,
  cellSizeM: number,
): number {
  if (!Number.isFinite(minimumFeatureM) || minimumFeatureM <= 0
    || !Number.isFinite(cellSizeM) || cellSizeM <= 0) {
    throw new Error("Topology minimum-feature dimensions are invalid");
  }
  return Math.ceil(minimumFeatureM / cellSizeM - 1e-9);
}

function validate(
  mask: BinaryMask,
  dimensions: TopologyCellDimensions,
  minimumFeatureM: number,
  cellSizeM: number,
): number {
  const [width, height, depth] = dimensions;
  if (dimensions.some((value) => !Number.isInteger(value) || value < 1)
    || mask.length !== width * height * depth
    || mask.some((value) => value !== 0 && value !== 1)) {
    throw new Error("Topology minimum-feature input is invalid");
  }
  return topologyMinimumFeatureCellWidth(minimumFeatureM, cellSizeM);
}

export function topologyMinimumFeatureOffenders(
  mask: BinaryMask,
  dimensions: TopologyCellDimensions,
  minimumFeatureM: number,
  cellSizeM: number,
): Uint32Array {
  const minimumCells = validate(mask, dimensions, minimumFeatureM, cellSizeM);
  if (minimumCells <= 1) return new Uint32Array();
  const [width, height, depth] = dimensions, plane = width * height;
  const index = (x: number, y: number, z: number) => x + width * (y + height * z);
  const run = (x: number, y: number, z: number, axis: number) => {
    let length = 1;
    for (const direction of [-1, 1]) for (let step = 1; ; step += 1) {
      const point = [x, y, z]; point[axis] += direction * step;
      if (point[axis]! < 0 || point[axis]! >= dimensions[axis]!
        || mask[index(point[0]!, point[1]!, point[2]!)] !== 1) break;
      length += 1;
    }
    return length;
  };
  const offenders: number[] = [];
  for (let cell = 0; cell < mask.length; cell += 1) {
    if (mask[cell] !== 1) continue;
    const z = Math.floor(cell / plane), rest = cell - z * plane;
    const y = Math.floor(rest / width), x = rest - y * width;
    if ([0, 1, 2].some((axis) => run(x, y, z, axis) < minimumCells)) offenders.push(cell);
  }
  return Uint32Array.from(offenders);
}

export function topologyMinimumFeatureSatisfied(
  mask: BinaryMask,
  dimensions: TopologyCellDimensions,
  minimumFeatureM: number,
  cellSizeM: number,
): boolean {
  return topologyMinimumFeatureOffenders(
    mask, dimensions, minimumFeatureM, cellSizeM,
  ).length === 0;
}
