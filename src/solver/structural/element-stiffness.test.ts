import { describe, expect, it } from "vitest";

import { buildHex8Stiffness } from "./element-stiffness";

describe("buildHex8Stiffness", () => {
  it("builds a symmetric 3D isotropic element with Poisson coupling and rigid translation nullspace", () => {
    const matrix = buildHex8Stiffness(200e9, 0.3, 0.01);
    expect(matrix).toHaveLength(24 * 24);
    for (let row = 0; row < 24; row += 1) {
      for (let column = 0; column < 24; column += 1) {
        expect(matrix[row * 24 + column]).toBeCloseTo(matrix[column * 24 + row]!, 3);
      }
    }
    expect(Math.abs(matrix[0 * 24 + 1]!)).toBeGreaterThan(1e6);
    const translated = new Float64Array(24);
    for (let node = 0; node < 8; node += 1) translated[node * 3] = 1;
    const residual = Array.from({ length: 24 }, (_, row) => {
      let value = 0;
      for (let column = 0; column < 24; column += 1) {
        value += matrix[row * 24 + column]! * translated[column]!;
      }
      return value;
    });
    const scale = Math.max(...matrix.map(Math.abs));
    expect(Math.max(...residual.map(Math.abs)) / scale).toBeLessThan(2e-6);
  });

  it("annihilates all six rigid-body modes", () => {
    const matrix = buildHex8Stiffness(70e9, 0.27, 0.02);
    const coordinates = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ];
    const modes = [0, 1, 2].map((axis) => coordinates.flatMap(() =>
      [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]));
    modes.push(
      coordinates.flatMap(([, y, z]) => [0, -z, y]),
      coordinates.flatMap(([x, , z]) => [z, 0, -x]),
      coordinates.flatMap(([x, y]) => [-y, x, 0]),
    );
    const scale = Math.max(...matrix.map(Math.abs));
    for (const mode of modes) {
      expect(Math.max(...multiply(matrix, mode).map(Math.abs)) / scale).toBeLessThan(3e-6);
    }
  });

  it("reproduces constant uniaxial strain energy and physical E/h scaling", () => {
    const youngs = 120e9;
    const poisson = 0.25;
    const size = 0.01;
    const strain = 1e-3;
    const matrix = buildHex8Stiffness(youngs, poisson, size);
    const displacement = [
      0, 0, 0, strain * size, 0, 0, 0, 0, 0, strain * size, 0, 0,
      0, 0, 0, strain * size, 0, 0, 0, 0, 0, strain * size, 0, 0,
    ];
    const energy = 0.5 * dot(displacement, multiply(matrix, displacement));
    const lambda = youngs * poisson / ((1 + poisson) * (1 - 2 * poisson));
    const mu = youngs / (2 * (1 + poisson));
    const expected = 0.5 * (lambda + 2 * mu) * strain ** 2 * size ** 3;
    expect(Math.abs(energy - expected) / expected).toBeLessThan(3e-6);

    const doubledE = buildHex8Stiffness(youngs * 2, poisson, size);
    const doubledH = buildHex8Stiffness(youngs, poisson, size * 2);
    const probe = matrix.findIndex((value) => Math.abs(value) === Math.max(...matrix.map(Math.abs)));
    expect(doubledE[probe]! / matrix[probe]!).toBeCloseTo(2, 5);
    expect(doubledH[probe]! / matrix[probe]!).toBeCloseTo(2, 5);
  });
});

function multiply(matrix: Float32Array, vector: readonly number[]): number[] {
  return Array.from({ length: 24 }, (_, row) => {
    let value = 0;
    for (let column = 0; column < 24; column += 1) {
      value += matrix[row * 24 + column]! * vector[column]!;
    }
    return value;
  });
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}
