import type { OcctKernel, ShapeHandle } from "occt-wasm";

import { CadRebuildError } from "./rebuild-errors";

export function assertExactSolid(kernel: OcctKernel, shape: ShapeHandle, message: string): void {
  const isNull = kernel.isNull(shape);
  const isSolid = !isNull && kernel.isSolid(shape);
  const solidCount = isNull ? 0 : kernel.subShapeCount(shape, "solid");
  const isValid = !isNull && kernel.isValid(shape);
  if ((!isSolid && solidCount === 0) || !isValid) {
    throw new CadRebuildError("invalid-solid", message);
  }
}
