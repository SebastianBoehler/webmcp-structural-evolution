import type { FieldGrid } from "./result-layers";

export const STRUCTURAL_DEFORMATION_EXAGGERATION = 1_000;

export interface ReplayDeformation {
  readonly values: Float32Array;
  readonly vectors: Float32Array;
  readonly maximum: number;
  readonly displacementUnit: "mm";
  readonly sourceDisplacementUnit: "m";
}

export function sampleReplayDisplacement(
  field: FieldGrid,
  vectors: Float32Array,
  point: readonly [number, number, number],
  scale: number,
): readonly [number, number, number] {
  const [width, height, depth] = field.dimensions;
  const coordinate = point.map((value, axis) => Math.max(0, Math.min(
    field.dimensions[axis]! - 1,
    Math.floor((value - field.origin[axis]!) / field.cellSize[axis]!),
  ))) as [number, number, number];
  const index = coordinate[0] + width * (coordinate[1] + height * coordinate[2]);
  if (index < 0 || index >= width * height * depth || vectors.length !== width * height * depth * 3) {
    throw new Error("Replay deformation does not match its field grid.");
  }
  return [vectors[index * 3]! * scale, vectors[index * 3 + 1]! * scale,
    vectors[index * 3 + 2]! * scale];
}
