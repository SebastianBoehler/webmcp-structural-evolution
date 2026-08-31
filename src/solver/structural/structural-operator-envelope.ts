import { buildHex8Stiffness } from "./element-stiffness";

const INVALID_OPERATOR = "Derived structural operator values must be positive finite f32";

function reject(): never {
  throw new Error(INVALID_OPERATOR);
}

export function validateStructuralOperatorEnvelope(
  youngsModulusPa: number,
  poissonRatio: number,
  cellSizeM: number,
): void {
  const representedCellSize = Math.fround(cellSizeM);
  const gradientDenominator = Math.fround(4 * representedCellSize);
  const centerGradientScale = Math.fround(1 / gradientDenominator);
  if (!Number.isFinite(gradientDenominator) || gradientDenominator <= 0
    || !Number.isFinite(centerGradientScale) || centerGradientScale <= 0) reject();

  let stiffness: Float32Array;
  try {
    stiffness = buildHex8Stiffness(youngsModulusPa, poissonRatio, cellSizeM);
  } catch {
    reject();
  }
  if (stiffness.some((value) => !Number.isFinite(value))) reject();
  for (let diagonal = 0; diagonal < 24; diagonal += 1) {
    const value = stiffness[diagonal * 24 + diagonal]!;
    if (!Number.isFinite(value) || value <= 0) reject();
  }
}
