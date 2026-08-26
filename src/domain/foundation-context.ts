import type { InventoryEvaluation } from "./design";

export interface ContextSelection {
  readonly id: string;
  readonly label: string;
  readonly min: readonly [number, number, number];
  readonly maxExclusive: readonly [number, number, number];
}

export interface FoundationGrid {
  readonly dimensions: { readonly width: number; readonly height: number; readonly depth: number };
  readonly cellSize: readonly [number, number, number];
  readonly anchor: {
    readonly position: readonly [number, number, number];
    readonly orientation: readonly [number, number, number, number];
  };
}

export interface FoundationContextSnapshot {
  readonly sourceRevision: string;
  readonly coordinateSpace: "assembly";
  readonly unit: "mm";
  readonly selection: ContextSelection;
  readonly locks: readonly string[];
  readonly grid: FoundationGrid;
  readonly interfaces: { readonly preservedMounts: number; readonly keepOuts: number };
  readonly inventory: {
    readonly status: InventoryEvaluation["status"];
    readonly shortages: InventoryEvaluation["shortages"];
    readonly shortageCount: number;
    readonly omittedShortageCount: number;
  };
}
