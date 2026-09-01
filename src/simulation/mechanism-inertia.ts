import { quaternionFromMatrix, type Matrix3, type Vec3Tuple } from "../cad/rigid-transform";

type Tensor = readonly [number, number, number, number, number, number, number, number, number];
interface MassPart {
  readonly massKg: number;
  readonly centerOfMassM: Vec3Tuple;
  readonly centroidalInertiaKgM2: Tensor;
}

function compensated(values: readonly number[]): number {
  let sum = 0, correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  return sum;
}

export function combineMassProperties(parts: readonly MassPart[]): MassPart {
  const massKg = compensated(parts.map(({ massKg: mass }) => mass));
  if (!(massKg > 0) || !Number.isFinite(massKg)) throw new Error("Mechanism body mass must be finite and positive");
  const centerOfMassM = [0, 1, 2].map((axis) => compensated(
    parts.map((part) => part.massKg * part.centerOfMassM[axis]!),
  ) / massKg) as unknown as Vec3Tuple;
  const contributions = Array.from({ length: 9 }, () => [] as number[]);
  for (const part of parts) {
    const d = part.centerOfMassM.map((value, axis) => value - centerOfMassM[axis]!) as unknown as Vec3Tuple;
    const squared = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
      contributions[row * 3 + column]!.push(part.centroidalInertiaKgM2[row * 3 + column]!
        + part.massKg * ((row === column ? squared : 0) - d[row]! * d[column]!));
    }
  }
  const inertia = contributions.map(compensated);
  return { massKg, centerOfMassM, centroidalInertiaKgM2: inertia as unknown as Tensor };
}

const column = (matrix: number[][], index: number): number[] => matrix.map((row) => row[index]!);
const dot = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, index) => sum + value * right[index]!, 0);
const cross = (a: readonly number[], b: readonly number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!,
];
const normalize = (vector: readonly number[]) => {
  const magnitude = Math.hypot(...vector);
  if (!(magnitude > 0)) throw new Error("Mechanism inertia eigenframe is degenerate");
  return vector.map((value) => value / magnitude);
};
const canonicalSign = (vector: readonly number[]) => {
  const normalized = normalize(vector);
  let selected = 0;
  for (let index = 1; index < normalized.length; index += 1) {
    if (Math.abs(normalized[index]!) > Math.abs(normalized[selected]!)) selected = index;
  }
  return normalized[selected]! < 0 ? normalized.map((value) => -value) : normalized;
};
const stablePerpendicular = (axis: readonly number[]) => {
  let selected: number[] | undefined, magnitude = -1;
  for (const candidate of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const projected = candidate.map((value, index) => value - dot(candidate, axis) * axis[index]!);
    const candidateMagnitude = Math.hypot(...projected);
    if (candidateMagnitude > magnitude) [selected, magnitude] = [projected, candidateMagnitude];
  }
  return canonicalSign(selected!);
};

function jacobi(tensor: Tensor) {
  const a = [[tensor[0], tensor[1], tensor[2]], [tensor[3], tensor[4], tensor[5]], [tensor[6], tensor[7], tensor[8]]];
  const vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iteration = 0; iteration < 32; iteration += 1) {
    let p = 0, q = 1;
    if (Math.abs(a[0]![2]!) > Math.abs(a[p]![q]!)) [p, q] = [0, 2];
    if (Math.abs(a[1]![2]!) > Math.abs(a[p]![q]!)) [p, q] = [1, 2];
    const off = a[p]![q]!;
    const scale = Math.max(1, ...a.flat().map(Math.abs));
    if (Math.abs(off) <= scale * 1e-15) break;
    const angle = 0.5 * Math.atan2(2 * off, a[q]![q]! - a[p]![p]!);
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    for (let index = 0; index < 3; index += 1) {
      const aip = a[index]![p]!, aiq = a[index]![q]!;
      a[index]![p] = cosine * aip - sine * aiq;
      a[index]![q] = sine * aip + cosine * aiq;
    }
    for (let index = 0; index < 3; index += 1) {
      const api = a[p]![index]!, aqi = a[q]![index]!;
      a[p]![index] = cosine * api - sine * aqi;
      a[q]![index] = sine * api + cosine * aqi;
      const vip = vectors[index]![p]!, viq = vectors[index]![q]!;
      vectors[index]![p] = cosine * vip - sine * viq;
      vectors[index]![q] = sine * vip + cosine * viq;
    }
  }
  return [0, 1, 2].map((index) => ({ value: a[index]![index]!, vector: column(vectors, index) }))
    .sort((left, right) => left.value - right.value);
}

export function diagonalizeInertia(tensor: Tensor) {
  if (tensor.some((value) => !Number.isFinite(value))) throw new Error("Mechanism inertia tensor must be finite");
  const symmetric = [...tensor] as number[];
  for (const [first, second] of [[1, 3], [2, 6], [5, 7]] as const) {
    const value = (symmetric[first] + symmetric[second]) / 2;
    symmetric[first] = value; symmetric[second] = value;
  }
  const scale = Math.max(...symmetric.map(Math.abs));
  if (!(scale > 0) || !Number.isFinite(scale)) throw new Error("Mechanism inertia tensor must be nonzero");
  const entries = jacobi(symmetric.map((value) => value / scale) as unknown as Tensor);
  const values = entries.map(({ value }) => value * scale) as [number, number, number];
  if (values.some((value) => !(value > 0) || !Number.isFinite(value))) {
    throw new Error("Mechanism principal inertia must be finite and positive");
  }
  const tolerance = Math.max(...values) * 1e-10;
  if (values[2] > values[0] + values[1] + tolerance) {
    throw new Error("Mechanism principal inertia violates the scale-relative triangle bound");
  }
  const firstPair = Math.abs(values[0] - values[1]) <= tolerance;
  const secondPair = Math.abs(values[1] - values[2]) <= tolerance;
  let axes: number[][];
  if (firstPair && secondPair) axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  else if (firstPair) {
    const third = canonicalSign(entries[2]!.vector);
    const first = stablePerpendicular(third);
    axes = [first, normalize(cross(third, first)), third];
  } else if (secondPair) {
    const first = canonicalSign(entries[0]!.vector);
    const second = stablePerpendicular(first);
    axes = [first, second, normalize(cross(first, second))];
  } else {
    const first = canonicalSign(entries[0]!.vector);
    const second = canonicalSign(entries[1]!.vector);
    let third = canonicalSign(entries[2]!.vector);
    if (dot(cross(first, second), third) < 0) third = third.map((value) => -value);
    axes = [first, second, third];
  }
  const rotation = [axes[0]![0], axes[1]![0], axes[2]![0], axes[0]![1], axes[1]![1], axes[2]![1],
    axes[0]![2], axes[1]![2], axes[2]![2]] as Matrix3;
  return { principalInertiaKgM2: values, principalInertiaFrameToBody: quaternionFromMatrix(rotation) };
}
