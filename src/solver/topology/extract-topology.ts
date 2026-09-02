import type { StructuralGrid } from "../structural/structural-contract";
import type {
  RequiredTopologyInterface,
  TopologyExtractionValidation,
  TopologyMesh,
} from "./topology-contract";
import { topologyMinimumFeatureSatisfied } from "./minimum-feature";

type Point = readonly [number, number, number];
type Face = readonly [Point, Point, Point, Point];

const FACE_OFFSETS = [
  [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
] as const;

function cellIndex(grid: StructuralGrid, x: number, y: number, z: number): number {
  return x + grid.cellDimensions[0] * (y + grid.cellDimensions[1] * z);
}

function cellPoint(grid: StructuralGrid, x: number, y: number, z: number): Point {
  return [
    grid.originM[0] + x * grid.cellSizeM,
    grid.originM[1] + y * grid.cellSizeM,
    grid.originM[2] + z * grid.cellSizeM,
  ];
}

function face(x: number, y: number, z: number, side: number): Face {
  const x0 = x, y0 = y, z0 = z, x1 = x + 1, y1 = y + 1, z1 = z + 1;
  switch (side) {
    case 0: return [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]];
    case 1: return [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]];
    case 2: return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    case 3: return [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]];
    case 4: return [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]];
    default: return [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  }
}

export function extractTopologyMesh(
  grid: StructuralGrid,
  density: Float32Array,
  settings: Readonly<{ isoValue: number; toleranceM: number }>,
  designDomain: Uint32Array,
): TopologyMesh {
  const count = grid.cellDimensions.reduce((product, value) => product * value, 1);
  if (density.length !== count || designDomain.length !== count
    || designDomain.some((value) => value !== 0 && value !== 1)
    || density.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Topology density must be finite, bounded, and match the structural grid");
  }
  if (density.some((value, cell) => value >= settings.isoValue && designDomain[cell] === 0)) {
    throw new Error("Topology extraction contains material outside the canonical design domain");
  }
  if (!Number.isFinite(settings.isoValue) || settings.isoValue <= 0 || settings.isoValue >= 1) {
    throw new Error("Topology extraction iso-value must lie inside (0, 1)");
  }
  if (!Number.isFinite(settings.toleranceM) || settings.toleranceM <= 0
    || settings.toleranceM > grid.cellSizeM * 0.25) {
    throw new Error("Topology extraction tolerance must be positive and at most one quarter cell");
  }
  const occupied = Uint8Array.from(density, (value) => Number(value >= settings.isoValue));
  const vertices: number[] = [], triangles: number[] = [];
  const vertexMap = new Map<string, number>();
  const addVertex = (lattice: Point) => {
    const key = lattice.join(":");
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length / 3;
    vertexMap.set(key, index);
    const point = cellPoint(grid, lattice[0], lattice[1], lattice[2]);
    if (point.some((value) => !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
      throw new Error("Topology extraction vertex is not representable as finite f32 SI geometry");
    }
    vertices.push(...point.map(Math.fround));
    return index;
  };
  const [width, height, depth] = grid.cellDimensions;
  for (let z = 0; z < depth; z += 1) for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!occupied[cellIndex(grid, x, y, z)]) continue;
      FACE_OFFSETS.forEach(([dx, dy, dz], side) => {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const boundary = nx < 0 || ny < 0 || nz < 0 || nx >= width || ny >= height || nz >= depth;
        if (!boundary && occupied[cellIndex(grid, nx, ny, nz)]) return;
        const corners = face(x, y, z, side).map(addVertex);
        triangles.push(corners[0]!, corners[1]!, corners[2]!, corners[0]!, corners[2]!, corners[3]!);
      });
    }
  }
  if (triangles.length === 0) throw new Error("Topology extraction produced an empty manufacturing mesh");
  return {
    positionsM: new Float32Array(vertices), triangles: new Uint32Array(triangles),
    isoValue: settings.isoValue, toleranceM: settings.toleranceM,
  };
}

function rayTriangle(point: Point, direction: Point, a: Point, b: Point, c: Point): number | undefined {
  const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as Point;
  const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as Point;
  const cross = [
    direction[1] * edge2[2] - direction[2] * edge2[1],
    direction[2] * edge2[0] - direction[0] * edge2[2],
    direction[0] * edge2[1] - direction[1] * edge2[0],
  ] as Point;
  const determinant = edge1[0] * cross[0] + edge1[1] * cross[1] + edge1[2] * cross[2];
  if (Math.abs(determinant) < 1e-12) return undefined;
  const inverse = 1 / determinant;
  const offset = [point[0] - a[0], point[1] - a[1], point[2] - a[2]] as Point;
  const u = inverse * (offset[0] * cross[0] + offset[1] * cross[1] + offset[2] * cross[2]);
  if (u < 0 || u > 1) return undefined;
  const q = [
    offset[1] * edge1[2] - offset[2] * edge1[1],
    offset[2] * edge1[0] - offset[0] * edge1[2],
    offset[0] * edge1[1] - offset[1] * edge1[0],
  ] as Point;
  const v = inverse * (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]);
  const distance = inverse * (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]);
  return v >= 0 && u + v <= 1 && distance > 1e-10 ? distance : undefined;
}

function meshPoint(mesh: TopologyMesh, vertex: number): Point {
  return [mesh.positionsM[vertex * 3]!, mesh.positionsM[vertex * 3 + 1]!, mesh.positionsM[vertex * 3 + 2]!];
}

export function rasterizeExtractedTopology(mesh: TopologyMesh, grid: StructuralGrid): Uint32Array {
  const integrity = edgeChecks(mesh);
  if (!integrity.closed || !integrity.oriented) {
    throw new Error("Topology manufacturing mesh must be finite, nondegenerate, closed, and outward oriented");
  }
  const count = grid.cellDimensions.reduce((product, value) => product * value, 1);
  const active = new Uint32Array(count);
  // Extracted faces lie on voxel lattice planes. A cell-center +X ray crosses
  // only X-normal faces and cannot pass through a lattice edge or vertex.
  const direction: Point = [1, 0, 0];
  const [width, height, depth] = grid.cellDimensions;
  for (let z = 0; z < depth; z += 1) for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = cellPoint(grid, x + 0.5, y + 0.5, z + 0.5);
      const crossings = new Set<number>();
      for (let cursor = 0; cursor < mesh.triangles.length; cursor += 3) {
        const distance = rayTriangle(base, direction,
          meshPoint(mesh, mesh.triangles[cursor]!), meshPoint(mesh, mesh.triangles[cursor + 1]!),
          meshPoint(mesh, mesh.triangles[cursor + 2]!));
        if (distance !== undefined) crossings.add(Math.round(distance / mesh.toleranceM));
      }
      active[cellIndex(grid, x, y, z)] = crossings.size % 2;
    }
  }
  return active;
}

function edgeChecks(mesh: TopologyMesh): { closed: boolean; oriented: boolean } {
  const undirected = new Map<string, number>(), directed = new Map<string, number>();
  let signedVolume = 0;
  let valid = mesh.positionsM.length >= 12 && mesh.positionsM.length % 3 === 0
    && mesh.triangles.length >= 12 && mesh.triangles.length % 3 === 0
    && mesh.positionsM.every(Number.isFinite);
  for (let cursor = 0; cursor < mesh.triangles.length; cursor += 3) {
    const tri = [mesh.triangles[cursor]!, mesh.triangles[cursor + 1]!, mesh.triangles[cursor + 2]!];
    if (tri.some((vertex) => vertex >= mesh.positionsM.length / 3)) { valid = false; continue; }
    const [a, b, c] = tri.map((vertex) => meshPoint(mesh, vertex)) as [Point, Point, Point];
    const ab: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Point = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross: Point = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.hypot(...cross) <= mesh.toleranceM ** 2) valid = false;
    signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (const [left, right] of [[0, 1], [1, 2], [2, 0]] as const) {
      const a = tri[left]!, b = tri[right]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      undirected.set(key, (undirected.get(key) ?? 0) + 1);
      directed.set(`${a}:${b}`, (directed.get(`${a}:${b}`) ?? 0) + 1);
    }
  }
  const linkManifold = [...Array(mesh.positionsM.length / 3).keys()].every((vertex) => {
    const link = new Map<number, Set<number>>();
    for (let cursor = 0; cursor < mesh.triangles.length; cursor += 3) {
      const triangle = [mesh.triangles[cursor]!, mesh.triangles[cursor + 1]!, mesh.triangles[cursor + 2]!];
      const local = triangle.indexOf(vertex);
      if (local < 0) continue;
      const left = triangle[(local + 1) % 3]!, right = triangle[(local + 2) % 3]!;
      if (!link.has(left)) link.set(left, new Set());
      if (!link.has(right)) link.set(right, new Set());
      link.get(left)!.add(right); link.get(right)!.add(left);
    }
    const first = link.keys().next().value as number | undefined;
    if (first === undefined || [...link.values()].some((neighbors) => neighbors.size !== 2)) return false;
    const seen = new Set([first]), queue = [first];
    while (queue.length) for (const next of link.get(queue.pop()!)!) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    return seen.size === link.size;
  });
  return {
    closed: valid && linkManifold && [...undirected.values()].every((count) => count === 2),
    oriented: valid && signedVolume > mesh.toleranceM ** 3 && [...undirected.keys()].every((key) => {
      const [a, b] = key.split(":");
      return directed.get(`${a}:${b}`) === 1 && directed.get(`${b}:${a}`) === 1;
    }),
  };
}

function connected(active: Uint32Array, grid: StructuralGrid, required: readonly number[]): boolean {
  if (required.length === 0 || required.some((value) => active[value] !== 1)) return false;
  const seen = new Set([required[0]!]), queue = [required[0]!];
  const [width, height, depth] = grid.cellDimensions, plane = width * height;
  while (queue.length) {
    const cell = queue.pop()!, z = Math.floor(cell / plane), rest = cell - z * plane;
    const y = Math.floor(rest / width), x = rest - y * width;
    for (const [dx, dy, dz] of FACE_OFFSETS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= width || ny >= height || nz >= depth) continue;
      const next = cellIndex(grid, nx, ny, nz);
      if (active[next] === 1 && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return required.every((value) => seen.has(value));
}

export function validateExtractedTopology(
  mesh: TopologyMesh,
  grid: StructuralGrid,
  constraints: Readonly<{
    requiredInterfaces: readonly RequiredTopologyInterface[];
    protectedVoidCellIndices: Uint32Array;
    minimumFeatureM: number;
  }>,
): TopologyExtractionValidation {
  const edges = edgeChecks(mesh);
  if (!edges.closed || !edges.oriented) return {
    ...edges,
    requiredInterfacesConnected: false,
    protectedVoidsClear: false,
    minimumFeatureSatisfied: false,
  };
  const active = rasterizeExtractedTopology(mesh, grid);
  const required = constraints.requiredInterfaces.flatMap(({ cellIndices }) => [...cellIndices]);
  return {
    ...edges,
    requiredInterfacesConnected: connected(active, grid, required),
    protectedVoidsClear: [...constraints.protectedVoidCellIndices].every((cell) => active[cell] === 0),
    minimumFeatureSatisfied: topologyMinimumFeatureSatisfied(
      active, grid.cellDimensions, constraints.minimumFeatureM, grid.cellSizeM,
    ),
  };
}
