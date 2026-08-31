const NODE_SIGNS = [
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
] as const;
const GAUSS = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)] as const;

function constitutive(youngsModulusPa: number, poissonRatio: number): Float64Array {
  const lambda = youngsModulusPa * poissonRatio
    / ((1 + poissonRatio) * (1 - 2 * poissonRatio));
  const mu = youngsModulusPa / (2 * (1 + poissonRatio));
  const matrix = new Float64Array(36);
  for (let axis = 0; axis < 3; axis += 1) {
    for (let other = 0; other < 3; other += 1) {
      matrix[axis * 6 + other] = axis === other ? lambda + 2 * mu : lambda;
    }
  }
  matrix[3 * 6 + 3] = mu;
  matrix[4 * 6 + 4] = mu;
  matrix[5 * 6 + 5] = mu;
  return matrix;
}

function strainMatrix(xi: number, eta: number, zeta: number, cellSizeM: number): Float64Array {
  const matrix = new Float64Array(6 * 24);
  for (let node = 0; node < 8; node += 1) {
    const [sx, sy, sz] = NODE_SIGNS[node]!;
    const dx = sx * (1 + sy * eta) * (1 + sz * zeta) / (4 * cellSizeM);
    const dy = sy * (1 + sx * xi) * (1 + sz * zeta) / (4 * cellSizeM);
    const dz = sz * (1 + sx * xi) * (1 + sy * eta) / (4 * cellSizeM);
    const column = node * 3;
    matrix[column] = dx;
    matrix[24 + column + 1] = dy;
    matrix[48 + column + 2] = dz;
    matrix[72 + column] = dy;
    matrix[72 + column + 1] = dx;
    matrix[96 + column + 1] = dz;
    matrix[96 + column + 2] = dy;
    matrix[120 + column] = dz;
    matrix[120 + column + 2] = dx;
  }
  return matrix;
}

export function buildHex8Stiffness(
  youngsModulusPa: number,
  poissonRatio: number,
  cellSizeM: number,
): Float32Array {
  if (!Number.isFinite(youngsModulusPa) || youngsModulusPa <= 0
    || !Number.isFinite(poissonRatio) || poissonRatio <= -1 || poissonRatio >= 0.5
    || !Number.isFinite(cellSizeM) || cellSizeM <= 0) {
    throw new RangeError("Hex8 stiffness requires finite isotropic material and positive cell size");
  }
  const elasticity = constitutive(youngsModulusPa, poissonRatio);
  const stiffness = new Float64Array(24 * 24);
  const determinant = cellSizeM ** 3 / 8;
  for (const xi of GAUSS) for (const eta of GAUSS) for (const zeta of GAUSS) {
    const strain = strainMatrix(xi, eta, zeta, cellSizeM);
    for (let row = 0; row < 24; row += 1) {
      for (let column = 0; column < 24; column += 1) {
        let value = 0;
        for (let a = 0; a < 6; a += 1) for (let b = 0; b < 6; b += 1) {
          value += strain[a * 24 + row]! * elasticity[a * 6 + b]! * strain[b * 24 + column]!;
        }
        stiffness[row * 24 + column] += value * determinant;
      }
    }
  }
  return new Float32Array(stiffness);
}
