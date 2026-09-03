import * as THREE from "three";

import type { FieldGrid } from "./result-layers";

type SurfaceGrid = Pick<FieldGrid, "dimensions" | "cellSize" | "origin">;

export type TopologyScalarLayer = FieldGrid & {
  readonly values: Float32Array;
  readonly maximum: number;
  readonly scalarScale?: number;
};

export interface TopologyDeformation {
  readonly vectors: Float32Array;
  readonly scale: number;
  readonly displacementUnit: "mm";
  readonly sourceDisplacementUnit?: "m" | "mm";
}

const cold = new THREE.Color(0x16b9ff);
const hot = new THREE.Color(0xff2d55);

function shape(grid: SurfaceGrid): readonly number[] {
  return [...grid.dimensions, ...grid.cellSize, ...grid.origin];
}

function sameShape(surface: THREE.Mesh, grid: SurfaceGrid): boolean {
  const expected = shape(grid);
  const actual = surface.userData.fieldShape as readonly number[] | undefined;
  return actual?.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function binding(surface: THREE.Mesh) {
  const indices = surface.userData.fieldIndices as Uint32Array | undefined;
  const basePositions = surface.userData.basePositions as Float32Array | undefined;
  const position = surface.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!indices || !basePositions || !position || indices.length !== position.count
    || basePositions.length !== position.count * 3) {
    throw new Error("Topology surface is missing its field binding.");
  }
  return { indices, basePositions, position };
}

function fieldVolume(surface: THREE.Mesh): number {
  const fieldShape = surface.userData.fieldShape as readonly number[] | undefined;
  if (!fieldShape || fieldShape.length !== 9) throw new Error("Topology surface has no field shape.");
  return fieldShape[0]! * fieldShape[1]! * fieldShape[2]!;
}

export function bindTopologySurfaceField(surface: THREE.Mesh, grid: SurfaceGrid): void {
  const position = surface.geometry.getAttribute("position");
  const indices = new Uint32Array(position.count);
  const [width, height, depth] = grid.dimensions;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(position.getX(vertex) / grid.cellSize[0])));
    const y = Math.max(0, Math.min(height - 1, Math.floor(position.getY(vertex) / grid.cellSize[1])));
    const z = Math.max(0, Math.min(depth - 1, Math.floor(position.getZ(vertex) / grid.cellSize[2])));
    indices[vertex] = x + width * (y + height * z);
  }
  surface.userData.fieldIndices = indices;
  surface.userData.fieldShape = shape(grid);
  surface.userData.basePositions = Float32Array.from(position.array as ArrayLike<number>);
  surface.userData.deformationScale = 0;
  surface.userData.deformationTreatment =
    "Solver displacement vectors in scene millimetres; replay scale is recorded separately";
}

export function colorTopologySurfaceField(
  surface: THREE.Mesh,
  values: Float32Array,
  maximum: number,
  scalarScale = 1,
): void {
  const { indices } = binding(surface);
  if (values.length !== fieldVolume(surface) || !Number.isFinite(maximum)
    || maximum <= 0 || !Number.isFinite(scalarScale) || scalarScale < 0) {
    throw new Error("Topology scalar field does not match its surface binding.");
  }
  const existing = surface.geometry.getAttribute("color");
  const colors = existing?.count === indices.length
    ? existing.array as Float32Array : new Float32Array(indices.length * 3);
  const color = new THREE.Color();
  indices.forEach((fieldIndex, vertex) => {
    const utilization = Math.max(0, Math.min(1, values[fieldIndex]! * scalarScale / maximum));
    color.copy(cold).lerp(hot, utilization);
    colors.set([color.r, color.g, color.b], vertex * 3);
  });
  const attribute = existing?.count === indices.length
    ? existing : new THREE.BufferAttribute(colors, 3);
  if (attribute !== existing) surface.geometry.setAttribute("color", attribute);
  attribute.needsUpdate = true;
}

export function deformTopologySurface(
  surface: THREE.Mesh,
  deformation?: TopologyDeformation,
): void {
  const { indices, basePositions, position } = binding(surface);
  if (deformation && (deformation.vectors.length !== fieldVolume(surface) * 3
    || !Number.isFinite(deformation.scale))) {
    throw new Error("Topology deformation does not match its surface binding.");
  }
  const inverseOrientation = surface.quaternion.clone().invert();
  const displacement = new THREE.Vector3();
  indices.forEach((fieldIndex, vertex) => {
    const target = vertex * 3;
    displacement.set(
      deformation?.vectors[fieldIndex * 3] ?? 0,
      deformation?.vectors[fieldIndex * 3 + 1] ?? 0,
      deformation?.vectors[fieldIndex * 3 + 2] ?? 0,
    ).multiplyScalar(deformation?.scale ?? 0).applyQuaternion(inverseOrientation);
    position.setXYZ(vertex, basePositions[target]! + displacement.x,
      basePositions[target + 1]! + displacement.y, basePositions[target + 2]! + displacement.z);
  });
  position.needsUpdate = true;
  surface.geometry.computeBoundingBox();
  surface.geometry.computeBoundingSphere();
  surface.userData.deformationScale = deformation?.scale ?? 0;
  surface.userData.displacementUnit = deformation?.displacementUnit;
  surface.userData.sourceDisplacementUnit = deformation?.sourceDisplacementUnit;
}

export function updateTopologySurfaceField(
  surface: THREE.Mesh,
  layer: TopologyScalarLayer,
  deformation?: TopologyDeformation,
): boolean {
  if (!sameShape(surface, layer)) return false;
  colorTopologySurfaceField(surface, layer.values, layer.maximum, layer.scalarScale);
  deformTopologySurface(surface, deformation);
  return true;
}
