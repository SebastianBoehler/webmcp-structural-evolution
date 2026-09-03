import type { VoxelGrid } from "./field-instances";

const SAMPLING = 2;
const MAXIMUM_TRIANGLES = 750_000;
const TETRAHEDRA = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
] as const;
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
] as const;

type Point = readonly [number, number, number];

export interface TopologyExtractionLayout {
  readonly sampleDimensions: readonly [number, number, number];
  readonly scalarBytes: number;
  readonly maximumTriangles: number;
  readonly triangleBytes: number;
}

export function topologyExtractionLayout(grid: VoxelGrid): TopologyExtractionLayout {
  const { width, height, depth } = grid.dimensions;
  const sampleDimensions = [width * SAMPLING + 2, height * SAMPLING + 2,
    depth * SAMPLING + 2] as const;
  const sampleCount = sampleDimensions.reduce((product, value) => product * value, 1);
  const cubeCount = sampleDimensions.reduce((product, value) => product * (value - 1), 1);
  if (!Number.isSafeInteger(sampleCount) || !Number.isSafeInteger(cubeCount)) {
    throw new RangeError("Topology extraction grid exceeds the safe integer budget.");
  }
  const maximumTriangles = Math.min(MAXIMUM_TRIANGLES, cubeCount * 12);
  return {
    sampleDimensions,
    scalarBytes: sampleCount * Float32Array.BYTES_PER_ELEMENT,
    maximumTriangles,
    triangleBytes: maximumTriangles * 9 * Float32Array.BYTES_PER_ELEMENT,
  };
}

function densityAt(field: Float32Array, grid: VoxelGrid, x: number, y: number, z: number): number {
  const { width, height, depth } = grid.dimensions;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const z0 = Math.max(0, Math.min(depth - 1, Math.floor(z)));
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const z1 = Math.min(depth - 1, z0 + 1);
  const tx = Math.max(0, Math.min(1, x - x0)), ty = Math.max(0, Math.min(1, y - y0));
  const tz = Math.max(0, Math.min(1, z - z0));
  const sample = (ix: number, iy: number, iz: number) => field[ix + width * (iy + height * iz)]!;
  const lerp = (left: number, right: number, amount: number) => left + (right - left) * amount;
  const lower = lerp(lerp(sample(x0, y0, z0), sample(x1, y0, z0), tx),
    lerp(sample(x0, y1, z0), sample(x1, y1, z0), tx), ty);
  const upper = lerp(lerp(sample(x0, y0, z1), sample(x1, y0, z1), tx),
    lerp(sample(x0, y1, z1), sample(x1, y1, z1), tx), ty);
  return lerp(lower, upper, tz);
}

function sampledField(field: Float32Array, grid: VoxelGrid, dimensions: readonly number[]): Float32Array {
  const [width, height, depth] = dimensions;
  const sampled = new Float32Array(width! * height! * depth!);
  for (let z = 1; z < depth! - 1; z += 1) for (let y = 1; y < height! - 1; y += 1) {
    for (let x = 1; x < width! - 1; x += 1) {
      sampled[x + width! * (y + height! * z)] = densityAt(
        field, grid, (x - 0.5) / SAMPLING - 0.5,
        (y - 0.5) / SAMPLING - 0.5, (z - 0.5) / SAMPLING - 0.5,
      );
    }
  }
  return sampled;
}

function intersection(left: Point, right: Point, leftValue: number, rightValue: number,
  isolation: number): Point {
  const difference = rightValue - leftValue;
  const amount = difference === 0 ? 0.5 : (isolation - leftValue) / difference;
  return [left[0] + (right[0] - left[0]) * amount,
    left[1] + (right[1] - left[1]) * amount,
    left[2] + (right[2] - left[2]) * amount];
}

function centroid(points: readonly Point[]): Point {
  const total = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1],
    sum[2] + point[2]] as [number, number, number], [0, 0, 0] as [number, number, number]);
  return [total[0] / points.length, total[1] / points.length, total[2] / points.length];
}

function writeTriangle(output: Float32Array, cursor: number, triangle: readonly Point[],
  outward: Point): number {
  if (cursor + 9 > output.length) throw new Error("Topology surface exceeds the triangle budget.");
  const [a, b, sourceC] = triangle as [Point, Point, Point];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [sourceC[0] - a[0], sourceC[1] - a[1], sourceC[2] - a[2]];
  const normal = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!,
    ab[0]! * ac[1]! - ab[1]! * ac[0]!];
  const reverse = normal[0]! * outward[0] + normal[1]! * outward[1]
    + normal[2]! * outward[2] < 0;
  const c = reverse ? b : sourceC, middle = reverse ? sourceC : b;
  output.set([...a, ...middle, ...c], cursor);
  return cursor + 9;
}

function emitTetrahedron(output: Float32Array, cursor: number, points: readonly Point[],
  values: readonly number[], isolation: number): number {
  const inside = [0, 1, 2, 3].filter((index) => values[index]! >= isolation);
  if (inside.length === 0 || inside.length === 4) return cursor;
  const outside = [0, 1, 2, 3].filter((index) => values[index]! < isolation);
  const insideCenter = centroid(inside.map((index) => points[index]!));
  const outsideCenter = centroid(outside.map((index) => points[index]!));
  const outward = outsideCenter.map((value, axis) => value - insideCenter[axis]!) as [number, number, number];
  const edge = (left: number, right: number) => intersection(
    points[left]!, points[right]!, values[left]!, values[right]!, isolation,
  );
  if (inside.length === 1 || outside.length === 1) {
    const center = inside.length === 1 ? inside[0]! : outside[0]!;
    const peers = inside.length === 1 ? outside : inside;
    return writeTriangle(output, cursor, peers.map((peer) => edge(center, peer)), outward);
  }
  const [a, b] = inside, [c, d] = outside;
  const ac = edge(a!, c!), ad = edge(a!, d!), bc = edge(b!, c!), bd = edge(b!, d!);
  cursor = writeTriangle(output, cursor, [ac, ad, bd], outward);
  return writeTriangle(output, cursor, [ac, bd, bc], outward);
}

export function extractRectangularTopologySurface(
  field: Float32Array,
  grid: VoxelGrid,
  isolation: number,
): Float32Array {
  const layout = topologyExtractionLayout(grid);
  const [width, height, depth] = layout.sampleDimensions;
  const sampled = sampledField(field, grid, layout.sampleDimensions);
  const output = new Float32Array(layout.maximumTriangles * 9);
  const rowStride = width, layerStride = width * height;
  let cursor = 0;
  for (let z = 0; z < depth - 1; z += 1) for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const first = x + rowStride * y + layerStride * z;
      const v0 = sampled[first]!, v1 = sampled[first + 1]!;
      const v2 = sampled[first + rowStride + 1]!, v3 = sampled[first + rowStride]!;
      const v4 = sampled[first + layerStride]!, v5 = sampled[first + layerStride + 1]!;
      const v6 = sampled[first + layerStride + rowStride + 1]!;
      const v7 = sampled[first + layerStride + rowStride]!;
      const firstInside = v0 >= isolation;
      if ((v1 >= isolation) === firstInside && (v2 >= isolation) === firstInside
        && (v3 >= isolation) === firstInside && (v4 >= isolation) === firstInside
        && (v5 >= isolation) === firstInside && (v6 >= isolation) === firstInside
        && (v7 >= isolation) === firstInside) continue;
      const values = [v0, v1, v2, v3, v4, v5, v6, v7];
      const points = CORNERS.map(([dx, dy, dz]): Point => [
        (x + dx) / SAMPLING * grid.cellSize[0] - grid.cellSize[0] / (2 * SAMPLING),
        (y + dy) / SAMPLING * grid.cellSize[1] - grid.cellSize[1] / (2 * SAMPLING),
        (z + dz) / SAMPLING * grid.cellSize[2] - grid.cellSize[2] / (2 * SAMPLING),
      ]);
      for (const tetrahedron of TETRAHEDRA) {
        cursor = emitTetrahedron(output, cursor, tetrahedron.map((corner) => points[corner]!),
          tetrahedron.map((corner) => values[corner]!), isolation);
      }
    }
  }
  if (cursor === 0) throw new Error("Topology surface extraction produced no triangles.");
  return output.slice(0, cursor);
}
