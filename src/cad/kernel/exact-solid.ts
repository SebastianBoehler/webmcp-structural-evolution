import type { OcctKernel, ShapeHandle } from "occt-wasm";

import { CadRebuildError } from "./rebuild-errors";

export function assertExactSolid(kernel: OcctKernel, shape: ShapeHandle, message: string): void {
  const isNull = kernel.isNull(shape);
  const solidCount = isNull ? 0 : kernel.subShapeCount(shape, "solid");
  const isSolid = !isNull && kernel.isSolid(shape);
  const isValid = !isNull && kernel.isValid(shape);
  if (solidCount !== 1 || !isSolid || !isValid) {
    throw new CadRebuildError("invalid-solid", message);
  }
}

const topologyKinds = ["vertex", "edge", "wire", "face", "shell"] as const;

function releaseAll(kernel: OcctKernel, shapes: readonly ShapeHandle[]): void {
  for (const shape of shapes) kernel.release(shape);
}

export function normalizeExactSolid(kernel: OcctKernel, shape: ShapeHandle, message: string): ShapeHandle {
  if (kernel.isSolid(shape)) {
    assertExactSolid(kernel, shape, message);
    return shape;
  }
  if (kernel.isNull(shape) || !kernel.isValid(shape)
    || kernel.subShapeCount(shape, "solid") !== 1) {
    throw new CadRebuildError("invalid-solid", message);
  }
  const solids = kernel.getSubShapes(shape, "solid");
  const solid = solids[0];
  if (!solid || solids.length !== 1 || topologyKinds.some((kind) =>
    kernel.subShapeCount(shape, kind) !== kernel.subShapeCount(solid, kind))) {
    releaseAll(kernel, solids);
    throw new CadRebuildError("invalid-solid", message);
  }
  try {
    assertExactSolid(kernel, solid, message);
  } catch (error) {
    kernel.release(solid);
    throw error;
  }
  kernel.release(shape);
  return solid;
}
