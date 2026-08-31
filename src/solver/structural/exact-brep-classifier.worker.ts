import { OcctKernel } from "occt-wasm";

interface Request {
  readonly requestId: string;
  readonly brepBytes: Uint8Array;
  readonly pointsM: Float64Array;
  readonly toleranceM: number;
}

self.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  void (async () => {
    const kernel = await OcctKernel.init();
    try {
      const shape = kernel.fromBREPBinary(request.brepBytes);
      try {
        if (!kernel.isValid(shape) || kernel.getShapeType(shape) !== "solid") {
          throw new Error("Exact BREP payload must contain exactly one valid solid");
        }
        const bounds = kernel.getBoundingBox(shape);
        const volumeM3 = kernel.getVolume(shape);
        if (!Number.isFinite(volumeM3) || volumeM3 <= 0) {
          throw new Error("Exact BREP solid has invalid volume");
        }
        const boundsM = Float64Array.from([
          bounds.xmin, bounds.ymin, bounds.zmin, bounds.xmax, bounds.ymax, bounds.zmax,
        ]);
        const activeCells = new Uint32Array(request.pointsM.length / 3);
        for (let index = 0; index < activeCells.length; index += 1) {
          activeCells[index] = Number(kernel.containsPoint(shape, {
            x: request.pointsM[index * 3]!,
            y: request.pointsM[index * 3 + 1]!,
            z: request.pointsM[index * 3 + 2]!,
          }, request.toleranceM));
        }
        self.postMessage(
          { requestId: request.requestId, activeCells, boundsM, volumeM3 },
          [activeCells.buffer, boundsM.buffer],
        );
      } finally {
        kernel.release(shape);
      }
    } catch (error) {
      self.postMessage({
        requestId: request.requestId,
        error: error instanceof Error ? error.message : "Exact BREP classification failed",
      });
    } finally {
      kernel[Symbol.dispose]();
    }
  })();
});
