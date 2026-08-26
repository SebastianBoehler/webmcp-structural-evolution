import type { FoundationContextSnapshot } from "../domain/foundation-context";

export function testFoundationContext(
  selection = { id: "motor-arm", label: "Motor arm" },
  locks: readonly string[] = ["body-mount"],
): FoundationContextSnapshot {
  return {
    sourceRevision: "a".repeat(64),
    coordinateSpace: "assembly",
    unit: "mm",
    selection: { ...selection, min: [0, 0, 0], maxExclusive: [32, 32, 32] },
    locks,
    grid: {
      dimensions: { width: 32, height: 32, depth: 32 },
      cellSize: [1, 1, 1],
      anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    },
    interfaces: { preservedMounts: 1, keepOuts: 0 },
    inventory: {
      status: "buildable", shortages: [], shortageCount: 0, omittedShortageCount: 0,
    },
  };
}
