import type { ProbeResult } from "../gpu/compute-probe";
import {
  assertFiniteF32,
  validateField,
  visibleInstances,
  type PackedInstances,
  type Vector3Tuple,
  type VoxelGrid,
} from "./field-instances";

export const MAX_VISIBLE_ALTERNATIVES = 3;
export type AlternativeMode = "overlay" | "peel" | "audition";

export interface SelectedSemanticRegion {
  readonly id: string;
  readonly label: string;
  readonly min: readonly [number, number, number];
  readonly maxExclusive: readonly [number, number, number];
}

export interface ViewerBranch {
  readonly branchRevision: string;
  readonly contextRevision: string;
  readonly parentRevision: string;
  readonly grid: VoxelGrid;
  readonly result: ProbeResult;
}

export interface AlternativeLayer {
  readonly branchRevision: string;
  readonly contextRevision: string;
  readonly parentRevision: string;
  readonly grid: VoxelGrid;
  readonly added: PackedInstances;
  readonly removed: PackedInstances;
  readonly auditionInstances?: PackedInstances;
  readonly displayOffset: Vector3Tuple;
}

export interface AlternativeComparison {
  readonly branchRevision: string;
  readonly contextRevision: string;
  readonly parentRevision: string;
  readonly sourceIndex: number;
  readonly status: "renderable" | "unverified" | "incompatible" | "invalid" | "limited";
  readonly reason: string;
  readonly addedCount: number;
  readonly removedCount: number;
}

export interface AlternativeExtraction {
  readonly layers: readonly AlternativeLayer[];
  readonly comparisons: readonly AlternativeComparison[];
  readonly omittedCount: number;
}

const tuplesEqual = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

function gridsEqual(left: VoxelGrid, right: VoxelGrid): boolean {
  return (
    left.dimensions.width === right.dimensions.width &&
    left.dimensions.height === right.dimensions.height &&
    left.dimensions.depth === right.dimensions.depth &&
    tuplesEqual(left.cellSize, right.cellSize) &&
    tuplesEqual(left.anchor.position, right.anchor.position) &&
    tuplesEqual(left.anchor.orientation, right.anchor.orientation)
  );
}

function validateRegion(region: SelectedSemanticRegion, grid: VoxelGrid): void {
  if (!region.id.trim() || !region.label.trim()) {
    throw new RangeError("selected region requires a stable ID and label");
  }
  const bounds = [grid.dimensions.width, grid.dimensions.height, grid.dimensions.depth];
  for (let axis = 0; axis < 3; axis += 1) {
    const min = region.min[axis]!;
    const max = region.maxExclusive[axis]!;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max <= min || max > bounds[axis]!) {
      throw new RangeError(`selected region axis ${axis} must use valid integer grid bounds`);
    }
  }
}

function peelOffset(index: number, grid: VoxelGrid): Vector3Tuple {
  const distance = Math.min(3, Math.max(...grid.cellSize) * 3);
  const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3] as const;
  const angle = angles[index]!;
  const offset: Vector3Tuple = [
    Number((Math.cos(angle) * distance).toFixed(6)),
    Number((Math.sin(angle) * distance).toFixed(6)),
    0,
  ];
  offset.forEach((value, axis) => assertFiniteF32(value, `peel offset[${axis}]`));
  return Object.freeze(offset);
}

function comparison(
  branch: ViewerBranch,
  sourceIndex: number,
  status: AlternativeComparison["status"],
  reason: string,
  addedCount = 0,
  removedCount = 0,
): AlternativeComparison {
  return Object.freeze({
    sourceIndex,
    branchRevision: branch.branchRevision,
    contextRevision: branch.contextRevision,
    parentRevision: branch.parentRevision,
    status,
    reason,
    addedCount,
    removedCount,
  });
}

export function extractAlternativeLayers(
  current: ViewerBranch,
  alternatives: readonly ViewerBranch[],
  region: SelectedSemanticRegion,
  threshold: number,
  mode: AlternativeMode,
  selectedAlternative?: string,
): AlternativeExtraction {
  if (current.result.status !== "verified") {
    throw new Error("current branch must contain verified probe output");
  }
  if (!current.branchRevision.trim() || !current.contextRevision.trim() || !current.parentRevision.trim()) {
    throw new Error("current branch, context, and parent revisions must be exact non-empty IDs");
  }
  validateField(current.result.output, current.grid);
  validateRegion(region, current.grid);
  if (!Number.isFinite(threshold)) throw new RangeError("threshold must be finite");

  const idCounts = new Map<string, number>();
  for (const branch of alternatives) {
    idCounts.set(branch.branchRevision, (idCounts.get(branch.branchRevision) ?? 0) + 1);
  }
  const layers: AlternativeLayer[] = [];
  const comparisons: AlternativeComparison[] = [];
  let omittedCount = 0;
  for (let sourceIndex = 0; sourceIndex < alternatives.length; sourceIndex += 1) {
    const branch = alternatives[sourceIndex]!;
    const invalidReason = !branch.branchRevision.trim()
      ? "missing branch revision: not rendered"
      : branch.branchRevision === current.branchRevision
        ? "branch revision collides with current revision: not rendered"
        : (idCounts.get(branch.branchRevision) ?? 0) > 1
          ? "duplicate branch revision: not rendered"
          : !branch.parentRevision.trim()
            ? "missing parent revision: not rendered"
            : undefined;
    if (invalidReason) {
      comparisons.push(comparison(branch, sourceIndex, "invalid", invalidReason));
      continue;
    }
    if (branch.result.status !== "verified") {
      comparisons.push(
        comparison(branch, sourceIndex, "unverified", `${branch.result.status}: ${branch.result.status === "estimate"
          ? "interactive estimate only" : branch.result.message}; not rendered`),
      );
      continue;
    }
    if (branch.parentRevision !== current.contextRevision || !gridsEqual(branch.grid, current.grid)) {
      comparisons.push(comparison(branch, sourceIndex, "incompatible", "incompatible grid, anchor, or parent: not rendered"));
      continue;
    }
    try {
      validateField(branch.result.output, branch.grid);
    } catch {
      comparisons.push(comparison(branch, sourceIndex, "incompatible", "invalid verified field metadata: not rendered"));
      continue;
    }
    const withinLayerBudget = layers.length < MAX_VISIBLE_ALTERNATIVES;
    const regionVolume = (region.maxExclusive[0] - region.min[0])
      * (region.maxExclusive[1] - region.min[1])
      * (region.maxExclusive[2] - region.min[2]);
    const added = withinLayerBudget ? new Uint32Array(regionVolume) : undefined;
    const removed = withinLayerBudget ? new Uint32Array(regionVolume) : undefined;
    let addedCount = 0;
    let removedCount = 0;
    const { width, height } = current.grid.dimensions;
    for (let z = region.min[2]; z < region.maxExclusive[2]; z += 1) {
      for (let y = region.min[1]; y < region.maxExclusive[1]; y += 1) {
        for (let x = region.min[0]; x < region.maxExclusive[0]; x += 1) {
          const index = x + y * width + z * width * height;
          const wasVisible = current.result.output[index]! >= threshold;
          const isVisible = branch.result.output[index]! >= threshold;
          if (!wasVisible && isVisible) {
            addedCount += 1;
            if (added) added[addedCount - 1] = index;
          }
          if (wasVisible && !isVisible) {
            removedCount += 1;
            if (removed) removed[removedCount - 1] = index;
          }
        }
      }
    }
    if (!withinLayerBudget) {
      omittedCount += 1;
      comparisons.push(
        comparison(branch, sourceIndex, "limited", "verified but beyond the three-branch render limit", addedCount, removedCount),
      );
      continue;
    }
    const layer: AlternativeLayer = Object.freeze({
      branchRevision: branch.branchRevision,
      contextRevision: branch.contextRevision,
      parentRevision: branch.parentRevision,
      grid: current.grid,
      added: added!.slice(0, addedCount),
      removed: removed!.slice(0, removedCount),
      auditionInstances: mode === "audition" && selectedAlternative === branch.branchRevision
        ? visibleInstances(branch.result.output, current.grid, threshold)
        : undefined,
      displayOffset: mode === "peel" ? peelOffset(layers.length, current.grid) : ([0, 0, 0] as const),
    });
    layers.push(layer);
    comparisons.push(comparison(branch, sourceIndex, "renderable", "verified local delta", addedCount, removedCount));
  }
  return Object.freeze({
    layers: Object.freeze(layers),
    comparisons: Object.freeze(comparisons),
    omittedCount,
  });
}
