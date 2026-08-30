import type { OcctKernel, ShapeHandle } from "occt-wasm";

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
  const millimetreShape = kernel.importStep(new TextDecoder().decode(bytes));
  try {
    return kernel.scale(millimetreShape, origin, OCCT_STEP_UNITS_TO_METRES);
  } finally {
    kernel.release(millimetreShape);
  }
}
