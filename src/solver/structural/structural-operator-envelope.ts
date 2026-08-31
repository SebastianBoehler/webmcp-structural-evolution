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
  for (let axis = 0; axis < 3; axis += 1) {
    let assembledDiagonal = Math.fround(0);
    for (let localNode = 0; localNode < 8; localNode += 1) {
      const localDof = localNode * 3 + axis;
      const value = stiffness[localDof * 24 + localDof]!;
      if (!Number.isFinite(value) || value <= 0) reject();
      assembledDiagonal = Math.fround(assembledDiagonal + value);
      if (!Number.isFinite(assembledDiagonal) || assembledDiagonal <= 0) reject();
    }
  }
}
