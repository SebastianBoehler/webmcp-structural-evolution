import type { OcctKernel, ShapeHandle } from "occt-wasm";

import { assertExactSolid } from "./exact-solid";
import { CadRebuildError } from "./rebuild-errors";

const origin = { x: 0, y: 0, z: 0 } as const;
const METRES_TO_OCCT_STEP_UNITS = 1_000;
const OCCT_STEP_UNITS_TO_METRES = 1 / METRES_TO_OCCT_STEP_UNITS;

export function exportStepBytes(kernel: OcctKernel, shape: ShapeHandle): Uint8Array {
  const millimetreShape = kernel.scale(shape, origin, METRES_TO_OCCT_STEP_UNITS);
  try {
    return new TextEncoder().encode(kernel.exportStep(millimetreShape));
  } finally {
    kernel.release(millimetreShape);
  }
}

export function importStepBytes(kernel: OcctKernel, bytes: Uint8Array): ShapeHandle {
  let millimetreShape: ShapeHandle | undefined;
  try {
    millimetreShape = kernel.importStep(new TextDecoder().decode(bytes));
    assertExactSolid(kernel, millimetreShape, "STEP import did not contain a valid exact solid");
    const metreShape = kernel.scale(millimetreShape, origin, OCCT_STEP_UNITS_TO_METRES);
    try {
      assertExactSolid(kernel, metreShape, "Scaled STEP import is not a valid exact solid");
      return metreShape;
    } catch (error) {
      kernel.release(metreShape);
      throw error;
    }
  } catch (error) {
    if (error instanceof CadRebuildError) throw error;
    const detail = error instanceof Error && error.message.length > 0
      ? `: ${error.message}`
      : "";
    throw new CadRebuildError("invalid-solid", `STEP import failed${detail}`);
  } finally {
    if (millimetreShape) kernel.release(millimetreShape);
  }
}
