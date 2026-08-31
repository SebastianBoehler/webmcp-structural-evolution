import { pointInsideClosedBody, type OwnedTriangle, type Point3 } from "./triangle-voxel-geometry";

export interface BoundaryRasterInput {
  readonly topologyIds: readonly string[];
  readonly triangles: readonly OwnedTriangle[];
  readonly activeCells: Uint32Array;
  readonly dimensions: readonly [number, number, number];
  readonly originM: Point3;
  readonly cellSizeM: number;
  readonly toleranceM: number;
}
export interface BoundaryRasterOutput {
  readonly cells: readonly number[][];
  readonly nodes: readonly number[][];
}
type WorkerResponse = Readonly<{
  requestId: string; output?: BoundaryRasterOutput; error?: string;
}>;

const cellIndex = (dims: BoundaryRasterInput["dimensions"], x: number, y: number, z: number) =>
  x + dims[0] * (y + dims[1] * z);
const nodeIndex = (dims: BoundaryRasterInput["dimensions"], x: number, y: number, z: number) =>
  x + (dims[0] + 1) * (y + (dims[1] + 1) * z);
const pointAt = (input: BoundaryRasterInput, x: number, y: number, z: number): Point3 => [
  input.originM[0] + x * input.cellSizeM,
  input.originM[1] + y * input.cellSizeM,
  input.originM[2] + z * input.cellSizeM,
];
const subtract = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function segmentHit(start: Point3, end: Point3, triangle: OwnedTriangle): number | undefined {
  const direction = subtract(end, start), edge1 = subtract(triangle.b, triangle.a);
  const edge2 = subtract(triangle.c, triangle.a), p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  const determinantTolerance = Number.EPSILON * 128
    * Math.hypot(...direction) * Math.hypot(...edge1) * Math.hypot(...edge2);
  if (Math.abs(determinant) <= determinantTolerance) return undefined;
  const inverse = 1 / determinant, translated = subtract(start, triangle.a);
  const u = dot(translated, p) * inverse;
  if (u < -1e-8 || u > 1 + 1e-8) return undefined;
  const q = cross(translated, edge1), v = dot(direction, q) * inverse;
  if (v < -1e-8 || u + v > 1 + 1e-8) return undefined;
  const t = dot(edge2, q) * inverse;
  return t >= -1e-8 && t <= 1 + 1e-8 ? t : undefined;
}

function outwardAlignment(triangle: OwnedTriangle, direction: readonly [number, number, number]): number {
  const normal = cross(subtract(triangle.b, triangle.a), subtract(triangle.c, triangle.a));
  const magnitude = Math.hypot(...normal);
  return magnitude > 0 ? dot(normal, direction) / magnitude : Number.NEGATIVE_INFINITY;
}

const DIRECTIONS = [
  [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
] as const;

function facetNodes(
  dims: BoundaryRasterInput["dimensions"], cell: readonly [number, number, number], direction: number,
): number[] {
  const axis = Math.floor(direction / 2), positive = direction % 2 === 1;
  const nodes: number[] = [];
  for (const first of [0, 1]) for (const second of [0, 1]) {
    const point = [...cell] as [number, number, number];
    point[axis] += positive ? 1 : 0;
    point[(axis + 1) % 3] += first;
    point[(axis + 2) % 3] += second;
    nodes.push(nodeIndex(dims, point[0], point[1], point[2]));
  }
  return nodes;
}

export function rasterizeStructuralBoundariesDirect(
  input: BoundaryRasterInput,
): BoundaryRasterOutput {
  const selectedCells = new Map(input.topologyIds.map((id) => [id, new Set<number>()]));
  const selectedNodes = new Map(input.topologyIds.map((id) => [id, new Set<number>()]));
  const hitTolerance = Math.max(Number.EPSILON * 128, input.toleranceM / input.cellSizeM * 1e-3);
  const byBody = new Map<string, OwnedTriangle[]>();
  for (const triangle of input.triangles) {
    const body = byBody.get(triangle.bodyId);
    if (body) body.push(triangle); else byBody.set(triangle.bodyId, [triangle]);
  }
  for (let z = 0; z < input.dimensions[2]; z += 1) {
    for (let y = 0; y < input.dimensions[1]; y += 1) for (let x = 0; x < input.dimensions[0]; x += 1) {
      const center = pointAt(input, x + .5, y + .5, z + .5);
      const semanticInside = [...byBody.values()].some((body) =>
        pointInsideClosedBody(center, body, input.toleranceM));
      if (Number(semanticInside) !== input.activeCells[cellIndex(input.dimensions, x, y, z)]) {
        throw new Error("Exact BREP and semantic mesh center occupancy do not correspond");
      }
    }
  }
  for (let z = 0; z < input.dimensions[2]; z += 1) {
    for (let y = 0; y < input.dimensions[1]; y += 1) for (let x = 0; x < input.dimensions[0]; x += 1) {
        const index = cellIndex(input.dimensions, x, y, z);
        if (input.activeCells[index] !== 1) continue;
        const center = pointAt(input, x + .5, y + .5, z + .5);
        for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
          const delta = DIRECTIONS[direction]!;
          const neighbor = [x + delta[0], y + delta[1], z + delta[2]] as const;
          const inside = neighbor.every((value, axis) => value >= 0 && value < input.dimensions[axis]!);
          if (inside && input.activeCells[cellIndex(input.dimensions, ...neighbor)] === 1) continue;
          const outside = pointAt(input, x + .5 + delta[0], y + .5 + delta[1], z + .5 + delta[2]);
          let owner: OwnedTriangle | undefined, nearest = Number.POSITIVE_INFINITY;
          let bestAlignment = Number.NEGATIVE_INFINITY;
          for (const triangle of input.triangles) {
            const hit = segmentHit(center, outside, triangle);
            if (hit === undefined) continue;
            const alignment = outwardAlignment(triangle, delta);
            if (!(alignment > 0)) continue;
            const nearer = hit < nearest - hitTolerance;
            const tiedBetter = Math.abs(hit - nearest) <= hitTolerance
              && (alignment > bestAlignment + hitTolerance
                || Math.abs(alignment - bestAlignment) <= hitTolerance
                  && triangle.topologyId < (owner?.topologyId ?? "\uffff"));
            if (nearer || tiedBetter) {
              owner = triangle; nearest = hit; bestAlignment = alignment;
            }
          }
          if (!owner) throw new Error("An exposed structural voxel facet has no exact semantic owner");
          const cells = selectedCells.get(owner.topologyId), nodes = selectedNodes.get(owner.topologyId);
          if (!cells || !nodes) continue;
          cells.add(index);
          for (const node of facetNodes(input.dimensions, [x, y, z], direction)) nodes.add(node);
        }
      }
  }
  const cells: number[][] = [], nodes: number[][] = [];
  for (const topologyId of input.topologyIds) {
    const ownedCells = [...selectedCells.get(topologyId)!].sort((a, b) => a - b);
    const ownedNodes = [...selectedNodes.get(topologyId)!].sort((a, b) => a - b);
    if (ownedCells.length === 0 || ownedNodes.length === 0) {
      throw new Error(`Exact face rasterized to an empty structural boundary: ${topologyId}`);
    }
    cells.push(ownedCells); nodes.push(ownedNodes);
  }
  return { cells, nodes };
}

const abortError = () => new DOMException("Structural boundary rasterization was cancelled", "AbortError");

export async function rasterizeStructuralBoundaries(
  input: BoundaryRasterInput, signal?: AbortSignal,
): Promise<BoundaryRasterOutput> {
  if (signal?.aborted) throw abortError();
  if (typeof Worker === "undefined") return rasterizeStructuralBoundariesDirect(input);
  const worker = new Worker(new URL("./structural-boundary-raster.worker.ts", import.meta.url), { type: "module" });
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { signal?.removeEventListener("abort", onAbort); worker.terminate(); };
    const onAbort = () => { cleanup(); reject(abortError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      if (event.data.requestId !== requestId) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.output) resolve(event.data.output);
      else reject(new Error("Structural boundary worker returned an invalid response"));
    });
    worker.addEventListener("error", (event) => {
      cleanup(); reject(new Error(event.message || "Structural boundary worker failed"));
    });
    worker.postMessage({ requestId, input });
  });
}
