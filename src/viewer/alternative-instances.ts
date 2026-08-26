import type { ProbeResult } from "../gpu/compute-probe";
import {
  instanceAt,
  validateField,
  type InstanceRecord,
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
  readonly parentRevision: string;
  readonly grid: VoxelGrid;
  readonly result: ProbeResult;
}

export interface AlternativeLayer {
  readonly branchRevision: string;
  readonly parentRevision: string;
  readonly grid: VoxelGrid;
  readonly added: readonly InstanceRecord[];
  readonly removed: readonly InstanceRecord[];
  readonly displayOffset: Vector3Tuple;
}

export interface AlternativeComparison {
  readonly branchRevision: string;
  readonly parentRevision: string;
  readonly status: "renderable" | "unverified" | "incompatible";
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
  return Object.freeze([
    Number((Math.cos(angle) * distance).toFixed(6)),
    Number((Math.sin(angle) * distance).toFixed(6)),
    0,
  ]);
}

function comparison(
  branch: ViewerBranch,
  status: AlternativeComparison["status"],
  reason: string,
  addedCount = 0,
  removedCount = 0,
): AlternativeComparison {
  return Object.freeze({
    branchRevision: branch.branchRevision,
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
): AlternativeExtraction {
  if (current.result.status !== "verified") {
    throw new Error("current branch must contain verified probe output");
  }
  if (!current.branchRevision.trim() || !current.parentRevision.trim()) {
    throw new Error("current branch and parent revisions must be exact non-empty IDs");
  }
  validateField(current.result.output, current.grid);
  validateRegion(region, current.grid);
  if (!Number.isFinite(threshold)) throw new RangeError("threshold must be finite");

  const considered = alternatives.slice(0, MAX_VISIBLE_ALTERNATIVES);
  const layers: AlternativeLayer[] = [];
  const comparisons: AlternativeComparison[] = [];
  for (const branch of considered) {
    if (branch.result.status !== "verified") {
      comparisons.push(
        comparison(branch, "unverified", `${branch.result.status}: ${branch.result.message}; not rendered`),
      );
      continue;
    }
    if (branch.parentRevision !== current.branchRevision || !gridsEqual(branch.grid, current.grid)) {
      comparisons.push(comparison(branch, "incompatible", "incompatible grid, anchor, or parent: not rendered"));
      continue;
    }
    try {
      validateField(branch.result.output, branch.grid);
    } catch {
      comparisons.push(comparison(branch, "incompatible", "invalid verified field metadata: not rendered"));
      continue;
    }
    const added: InstanceRecord[] = [];
    const removed: InstanceRecord[] = [];
    const { width, height } = current.grid.dimensions;
    for (let z = region.min[2]; z < region.maxExclusive[2]; z += 1) {
      for (let y = region.min[1]; y < region.maxExclusive[1]; y += 1) {
        for (let x = region.min[0]; x < region.maxExclusive[0]; x += 1) {
          const index = x + y * width + z * width * height;
          const wasVisible = current.result.output[index]! >= threshold;
          const isVisible = branch.result.output[index]! >= threshold;
          if (!wasVisible && isVisible) added.push(instanceAt(branch.result.output, current.grid, index));
          if (wasVisible && !isVisible) removed.push(instanceAt(current.result.output, current.grid, index));
        }
      }
    }
    const layer = Object.freeze({
      branchRevision: branch.branchRevision,
      parentRevision: branch.parentRevision,
      grid: current.grid,
      added: Object.freeze(added),
      removed: Object.freeze(removed),
      displayOffset: mode === "peel" ? peelOffset(layers.length, current.grid) : ([0, 0, 0] as const),
    });
    layers.push(layer);
    comparisons.push(comparison(branch, "renderable", "verified local delta", added.length, removed.length));
  }
  return Object.freeze({
    layers: Object.freeze(layers),
    comparisons: Object.freeze(comparisons),
    omittedCount: Math.max(0, alternatives.length - considered.length),
  });
}
