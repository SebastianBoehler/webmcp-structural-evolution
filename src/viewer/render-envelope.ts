import type { AlternativeLayer } from "./alternative-instances";
import type { CadMesh } from "../assembly/step-import";
import type { StructuralLoadCase } from "../optimization/structural-load-cases";
import {
  assertFiniteF32,
  fieldInstanceCount,
  type PackedInstances,
  type QuaternionTuple,
  type Vector3Tuple,
  type VoxelGrid,
} from "./field-instances";

// Assembly coordinates use study units (millimetres in the foundation study).
// One million units is a deliberately conservative engineering-viewer world bound.
export const MAX_RENDER_COORDINATE = 1_000_000;
const INSTANCE_SCALE = Math.fround(0.94);
const ZERO_OFFSET = [0, 0, 0] as const;

export interface ViewerRenderModel {
  readonly grid: VoxelGrid;
  readonly currentInstances: PackedInstances;
  readonly alternativeLayers: readonly AlternativeLayer[];
  readonly assemblyParts?: readonly AssemblyVisualPart[];
  readonly densityField?: Float32Array;
  readonly analysisField?: ScalarAnalysisField;
}

export interface ScalarAnalysisField {
  readonly kind: "displacement" | "stress" | "safety";
  readonly values: Float32Array;
  readonly maximum: number;
  readonly cases?: Readonly<Partial<Record<StructuralLoadCase, ScalarAnalysisCaseField>>>;
}

export interface ScalarAnalysisCaseField {
  readonly values: Float32Array;
  readonly maximum: number;
}

export type AssemblyVisualPart = Readonly<{
  id: string;
  selectionId: string;
  label: string;
  center: Vector3Tuple;
  rotation?: Vector3Tuple;
  dragGroup?: string;
  movable?: boolean;
  appearance: "component" | "generated" | "design-region" | "constraint";
}> & (
  | Readonly<{ kind: "box"; size: Vector3Tuple }>
  | Readonly<{ kind: "cylinder"; radius: number; height: number }>
  | Readonly<{ kind: "motor-mount"; radius: number; height: number; boltCircle: number; boltRadius: number }>
  | Readonly<{
      kind: "motor";
      base: AxialVisualFeature;
      stator: AxialVisualFeature;
      bell: AxialVisualFeature;
      shaft: AxialVisualFeature;
      mountHoles: readonly MountHoleVisualFeature[];
      localBounds: LocalVisualBounds;
    }>
  | Readonly<{
      kind: "fastener";
      shank: AxialVisualFeature;
      head: AxialVisualFeature;
      socketWidth: number;
      socketDepth: number;
      socketCenterZ: number;
      localBounds: LocalVisualBounds;
    }>
  | Readonly<{ kind: "flight-controller"; size: Vector3Tuple }>
  | Readonly<{ kind: "propeller"; radius: number; hubRadius: number; hubHeight: number; bladeCount: number }>
  | Readonly<{ kind: "guard"; radius: number; tubeRadius: number }>
  | Readonly<{ kind: "protected-disc"; radius: number; height: number }>
  | Readonly<{
      kind: "model";
      assetUrl: string;
      assetUnits: "mm" | "m";
      size: Vector3Tuple;
    }>
  | Readonly<{ kind: "mesh"; mesh: CadMesh }>
  | Readonly<{ kind: "load-vector"; forceN: Vector3Tuple; length: number }>
);

export interface AxialVisualFeature { readonly radius: number; readonly height: number; readonly centerZ: number }
export interface MountHoleVisualFeature extends AxialVisualFeature { readonly centerX: number; readonly centerY: number }
export interface LocalVisualBounds { readonly minimum: Vector3Tuple; readonly maximum: Vector3Tuple }

export interface CameraEnvelope {
  readonly target: Vector3Tuple;
  readonly position: Vector3Tuple;
  readonly span: number;
  readonly near: number;
  readonly far: number;
}

export interface PreparedRenderModel extends ViewerRenderModel {
  readonly camera: CameraEnvelope;
}

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

function packed(value: number, label: string): number {
  assertFiniteF32(value, label);
  return Math.fround(value);
}

function bounded(value: number, label: string): number {
  const result = packed(value, label);
  if (Math.abs(result) > MAX_RENDER_COORDINATE) {
    throw new RangeError(`${label} exceeds the ${MAX_RENDER_COORDINATE}-unit world envelope`);
  }
  return result;
}

function f32Add(left: number, right: number, label: string): number {
  return packed(Math.fround(left) + Math.fround(right), label);
}

function f32Multiply(left: number, right: number, label: string): number {
  return packed(Math.fround(left) * Math.fround(right), label);
}

function normalizeGrid(grid: VoxelGrid): VoxelGrid {
  fieldInstanceCount(grid);
  const length = Math.hypot(...grid.anchor.orientation);
  const orientation = grid.anchor.orientation.map((value, axis) => {
    const normalized = value / length;
    assertFiniteF32(normalized, `normalized orientation[${axis}]`);
    return normalized;
  }) as unknown as QuaternionTuple;
  return Object.freeze({
    ...grid,
    anchor: Object.freeze({ ...grid.anchor, orientation: Object.freeze(orientation) }),
  });
}

function rotationMatrix(orientation: QuaternionTuple): readonly number[] {
  const [x, y, z, w] = orientation;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  ].map((value, index) => packed(value, `rotation coefficient[${index}]`));
}

function translation(grid: VoxelGrid, offset: readonly number[], label: string): Vector3Tuple {
  if (!Array.isArray(offset) || offset.length !== 3) {
    throw new RangeError(`${label} offset must contain exactly 3 values`);
  }
  return Object.freeze(grid.anchor.position.map((value, axis) => {
    bounded(offset[axis]!, `${label} offset[${axis}]`);
    return bounded(
      f32Add(value, offset[axis]!, `${label} translation[${axis}]`),
      `${label} translation[${axis}]`,
    );
  }) as unknown as Vector3Tuple);
}

function includeInstances(
  indices: PackedInstances,
  grid: VoxelGrid,
  offset: readonly number[],
  bounds: Bounds,
  label: string,
): void {
  if (indices.length === 0) return;
  const matrix = rotationMatrix(grid.anchor.orientation);
  const gridVolume = fieldInstanceCount(grid);
  const meshTranslation = translation(grid, offset, label);
  const half = grid.cellSize.map((size, axis) => bounded(
    f32Multiply(size / 2, INSTANCE_SCALE, `${label} half extent[${axis}]`),
    `${label} half extent[${axis}]`,
  ));
  const localMin = new Float64Array([Infinity, Infinity, Infinity]);
  const localMax = new Float64Array([-Infinity, -Infinity, -Infinity]);
  indices.forEach((fieldIndex, recordIndex) => {
    if (fieldIndex >= gridVolume) {
      throw new RangeError(`${label} instance[${recordIndex}] index exceeds the grid`);
    }
    const { width, height } = grid.dimensions;
    const x = bounded((fieldIndex % width + 0.5) * grid.cellSize[0], `${label} instance[${recordIndex}] x`);
    const y = bounded((Math.floor(fieldIndex / width) % height + 0.5) * grid.cellSize[1], `${label} instance[${recordIndex}] y`);
    const z = bounded((Math.floor(fieldIndex / (width * height)) + 0.5) * grid.cellSize[2], `${label} instance[${recordIndex}] z`);
    localMin[0] = Math.min(localMin[0]!, x);
    localMin[1] = Math.min(localMin[1]!, y);
    localMin[2] = Math.min(localMin[2]!, z);
    localMax[0] = Math.max(localMax[0]!, x);
    localMax[1] = Math.max(localMax[1]!, y);
    localMax[2] = Math.max(localMax[2]!, z);
  });
  for (let worldAxis = 0; worldAxis < 3; worldAxis += 1) {
    let minimum = meshTranslation[worldAxis]!;
    let maximum = meshTranslation[worldAxis]!;
    let radius = 0;
    for (let localAxis = 0; localAxis < 3; localAxis += 1) {
      const coefficient = matrix[worldAxis * 3 + localAxis]!;
      const first = f32Multiply(coefficient, localMin[localAxis]!, `${label} bound term`);
      const second = f32Multiply(coefficient, localMax[localAxis]!, `${label} bound term`);
      minimum = f32Add(minimum, Math.min(first, second), `${label} world minimum`);
      maximum = f32Add(maximum, Math.max(first, second), `${label} world maximum`);
      radius = f32Add(
        radius,
        Math.abs(f32Multiply(coefficient, half[localAxis]!, `${label} radius term`)),
        `${label} world radius`,
      );
    }
    minimum = bounded(f32Add(minimum, -radius, `${label} world minimum`), `${label} world minimum`);
    maximum = bounded(f32Add(maximum, radius, `${label} world maximum`), `${label} world maximum`);
    bounds.min[worldAxis] = Math.min(bounds.min[worldAxis], minimum);
    bounds.max[worldAxis] = Math.max(bounds.max[worldAxis], maximum);
  }
}

function cameraFor(grid: VoxelGrid, bounds: Bounds, focusAssembly: boolean): CameraEnvelope {
  const ranges = bounds.max.map((maximum, axis) => maximum - bounds.min[axis]!);
  const span = bounded(Math.max(1, ...ranges, ...grid.cellSize), "camera span");
  const target = Object.freeze(grid.anchor.position.map((value, axis) =>
    bounded(
      focusAssembly ? (bounds.min[axis]! + bounds.max[axis]!) / 2 : value,
      `camera target[${axis}]`,
    ),
  )) as Vector3Tuple;
  const position = Object.freeze([1.4, 1, 1.8].map((factor, axis) => bounded(
    f32Add(
      target[axis]!,
      f32Multiply(span, factor, `camera offset[${axis}]`),
      `camera position[${axis}]`,
    ),
    `camera position[${axis}]`,
  ))) as Vector3Tuple;
  return Object.freeze({
    target,
    position,
    span,
    near: bounded(Math.max(0.01, span / 1000), "camera near plane"),
    far: bounded(Math.max(1, span * 20), "camera far plane"),
  });
}

function includeAssemblyPart(part: AssemblyVisualPart, bounds: Bounds, index: number): void {
  const label = `assembly part[${index}]`;
  if (!part.id.trim() || !part.selectionId.trim() || !part.label.trim()) {
    throw new RangeError(`${label} requires an id, selection id, and label`);
  }
  if (part.kind === "motor" || part.kind === "fastener") {
    part.center.forEach((value, axis) => {
      const center = bounded(value, `${label} center[${axis}]`);
      bounds.min[axis] = Math.min(bounds.min[axis], bounded(center + part.localBounds.minimum[axis]!, `${label} minimum[${axis}]`));
      bounds.max[axis] = Math.max(bounds.max[axis], bounded(center + part.localBounds.maximum[axis]!, `${label} maximum[${axis}]`));
    });
    return;
  }
  const extents = part.kind === "mesh" ? part.mesh.sizeMm
    : part.kind === "load-vector" ? [4, 4, part.length]
    : part.kind === "box" || part.kind === "model" || part.kind === "flight-controller"
    ? part.size
    : part.kind === "guard"
      ? [part.radius + part.tubeRadius, part.radius + part.tubeRadius, part.tubeRadius]
      : part.kind === "propeller"
        ? [part.radius, part.radius, part.hubHeight / 2]
        : [part.radius, part.radius, part.height / 2];
  const half = (part.kind === "box" || part.kind === "model" || part.kind === "mesh" || part.kind === "flight-controller")
    ? extents.map((value, axis) => bounded(value / 2, `${label} half size[${axis}]`))
    : extents.map((value, axis) => bounded(value, `${label} half size[${axis}]`));
  part.center.forEach((value, axis) => {
    const center = bounded(value, `${label} center[${axis}]`);
    bounds.min[axis] = Math.min(bounds.min[axis], bounded(center - half[axis]!, `${label} minimum[${axis}]`));
    bounds.max[axis] = Math.max(bounds.max[axis], bounded(center + half[axis]!, `${label} maximum[${axis}]`));
  });
}

export function prepareRenderModel(model: ViewerRenderModel): PreparedRenderModel {
  const grid = normalizeGrid(model.grid);
  const anchor = grid.anchor.position;
  const bounds: Bounds = { min: [...anchor], max: [...anchor] };
  const assemblyParts = model.assemblyParts ?? [];
  assemblyParts.forEach((part, index) => includeAssemblyPart(part, bounds, index));
  includeInstances(model.currentInstances, grid, ZERO_OFFSET, bounds, "current");
  const layers = model.alternativeLayers.map((layer, index) => {
    const layerGrid = normalizeGrid(layer.grid);
    const prefix = `alternative[${index}]`;
    includeInstances(layer.added, layerGrid, layer.displayOffset, bounds, `${prefix} added`);
    includeInstances(layer.removed, layerGrid, layer.displayOffset, bounds, `${prefix} removed`);
    if (layer.auditionInstances) {
      includeInstances(layer.auditionInstances, layerGrid, ZERO_OFFSET, bounds, `${prefix} audition`);
    }
    return Object.freeze({ ...layer, grid: layerGrid });
  });
  return Object.freeze({
    grid,
    currentInstances: model.currentInstances,
    densityField: model.densityField,
    analysisField: model.analysisField,
    alternativeLayers: Object.freeze(layers),
    assemblyParts: Object.freeze(assemblyParts),
    camera: cameraFor(grid, bounds, assemblyParts.length > 0),
  });
}
