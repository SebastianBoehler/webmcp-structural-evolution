import { OcctKernel } from "occt-wasm";

import type { Point3 } from "./triangle-voxel-geometry";

interface ClassifierRequest {
  readonly requestId: string;
  readonly brepBytes: Uint8Array;
  readonly pointsM: Float64Array;
  readonly toleranceM: number;
}

interface ClassifierResponse {
  readonly requestId: string;
  readonly activeCells?: Uint32Array;
  readonly boundsM?: Float64Array;
  readonly volumeM3?: number;
  readonly error?: string;
}

export interface ExactBrepClassification {
  readonly activeCells: Uint32Array;
  readonly boundsM: Float64Array;
  readonly volumeM3: number;
}

export async function classifyExactBrepDirect(
  brepBytes: Uint8Array,
  points: readonly Point3[],
  toleranceM: number,
): Promise<ExactBrepClassification> {
  const kernel = await OcctKernel.init();
  try {
    const shape = kernel.fromBREPBinary(brepBytes);
    try {
      if (!kernel.isValid(shape) || kernel.getShapeType(shape) !== "solid") {
        throw new Error("Exact BREP payload must contain exactly one valid solid");
      }
      const bounds = kernel.getBoundingBox(shape);
      const volumeM3 = kernel.getVolume(shape);
      if (!Number.isFinite(volumeM3) || volumeM3 <= 0) {
        throw new Error("Exact BREP solid has invalid volume");
      }
      const activeCells = Uint32Array.from(points, (point) => Number(kernel.containsPoint(shape, {
        x: point[0], y: point[1], z: point[2],
      }, toleranceM)));
      return {
        activeCells,
        boundsM: Float64Array.from([
          bounds.xmin, bounds.ymin, bounds.zmin, bounds.xmax, bounds.ymax, bounds.zmax,
        ]),
        volumeM3,
      };
    } finally {
      kernel.release(shape);
    }
  } finally {
    kernel[Symbol.dispose]();
  }
}

function abortError(): DOMException {
  return new DOMException("Exact BREP voxel classification was cancelled", "AbortError");
}

export async function classifyExactBrepCells(
  brepBytes: Uint8Array,
  points: readonly Point3[],
  toleranceM: number,
  signal?: AbortSignal,
): Promise<ExactBrepClassification> {
  if (signal?.aborted) throw abortError();
  if (typeof Worker === "undefined") {
    const result = await classifyExactBrepDirect(brepBytes, points, toleranceM);
    if (signal?.aborted) throw abortError();
    return result;
  }
  const worker = new Worker(new URL("./exact-brep-classifier.worker.ts", import.meta.url), { type: "module" });
  const requestId = crypto.randomUUID();
  const pointsM = Float64Array.from(points.flatMap((point) => [...point]));
  return new Promise<ExactBrepClassification>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => { cleanup(); reject(abortError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", (event: MessageEvent<ClassifierResponse>) => {
      if (event.data.requestId !== requestId) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.activeCells instanceof Uint32Array
        && event.data.boundsM instanceof Float64Array
        && typeof event.data.volumeM3 === "number") {
        resolve({
          activeCells: event.data.activeCells,
          boundsM: event.data.boundsM,
          volumeM3: event.data.volumeM3,
        });
      }
      else reject(new Error("Exact BREP voxel classifier returned an invalid response"));
    });
    worker.addEventListener("error", (event) => {
      cleanup(); reject(new Error(event.message || "Exact BREP voxel classifier worker failed"));
    });
    const request: ClassifierRequest = {
      requestId, brepBytes: new Uint8Array(brepBytes), pointsM, toleranceM,
    };
    worker.postMessage(request, [request.brepBytes.buffer, request.pointsM.buffer]);
  });
}
