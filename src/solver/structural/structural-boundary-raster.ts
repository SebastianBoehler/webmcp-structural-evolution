import {
  pointTriangleDistanceSquared, type OwnedTriangle, type Point3,
} from "./triangle-voxel-geometry";

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

export function rasterizeStructuralBoundariesDirect(
  input: BoundaryRasterInput,
): BoundaryRasterOutput {
  const cells: number[][] = [], nodes: number[][] = [];
  const cellDistance = input.cellSizeM * Math.sqrt(3) * .5 + input.toleranceM;
  const byTopology = new Map<string, OwnedTriangle[]>();
  for (const triangle of input.triangles) {
    const owned = byTopology.get(triangle.topologyId);
    if (owned) owned.push(triangle); else byTopology.set(triangle.topologyId, [triangle]);
  }
  for (const topologyId of input.topologyIds) {
    const face = byTopology.get(topologyId) ?? [], selectedCells: number[] = [];
    for (let z = 0; z < input.dimensions[2]; z += 1) {
      for (let y = 0; y < input.dimensions[1]; y += 1) for (let x = 0; x < input.dimensions[0]; x += 1) {
        const index = cellIndex(input.dimensions, x, y, z);
        if (input.activeCells[index] !== 1) continue;
        const center = pointAt(input, x + .5, y + .5, z + .5);
        if (face.some((triangle) => pointTriangleDistanceSquared(center, triangle) <= cellDistance ** 2)) {
          selectedCells.push(index);
        }
      }
    }
    const ownedNodes = new Set<number>();
    for (const cell of selectedCells) {
      const z = Math.floor(cell / (input.dimensions[0] * input.dimensions[1]));
      const rest = cell - z * input.dimensions[0] * input.dimensions[1];
      const y = Math.floor(rest / input.dimensions[0]), x = rest - y * input.dimensions[0];
      for (const dz of [0, 1]) for (const dy of [0, 1]) for (const dx of [0, 1]) {
        const point = pointAt(input, x + dx, y + dy, z + dz);
        if (face.some((triangle) => pointTriangleDistanceSquared(point, triangle) <= input.toleranceM ** 2)) {
          ownedNodes.add(nodeIndex(input.dimensions, x + dx, y + dy, z + dz));
        }
      }
    }
    if (selectedCells.length === 0 || ownedNodes.size === 0) {
      throw new Error(`Exact face rasterized to an empty structural boundary: ${topologyId}`);
    }
    cells.push(selectedCells); nodes.push([...ownedNodes].sort((a, b) => a - b));
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
