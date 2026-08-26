import {
  evaluateInventory,
  freezeSnapshot,
  type AssemblySpec,
  type InventoryItem,
  type StudySpec,
} from "../domain/design";
import type { ContextSelection, FoundationContextSnapshot } from "../domain/foundation-context";
import { TOPOLOGY_ANCHOR, TOPOLOGY_CELL_SIZE, TOPOLOGY_DIMENSIONS } from "../optimization/topology-config";

interface FoundationContextSource {
  readonly assembly: AssemblySpec;
  readonly inventory: readonly InventoryItem[];
  readonly study: StudySpec;
  readonly selection: ContextSelection;
}

export function createFoundationContext({
  assembly, inventory, study, selection,
}: FoundationContextSource): FoundationContextSnapshot {
  const envelope = assembly.targetEnvelope;
  if (envelope.kind !== "box") throw new Error("Foundation grid requires the exact box target envelope");
  const axes = [envelope.center.x, envelope.center.y, envelope.center.z, envelope.size.x, envelope.size.y, envelope.size.z];
  if (axes.some(({ unit }) => unit !== "m")) throw new Error("Foundation context requires SI geometry");
  const dimensions = TOPOLOGY_DIMENSIONS;
  const evaluation = evaluateInventory(inventory, assembly);
  const shortageLimit = 2;
  return freezeSnapshot({
    sourceRevision: study.revision,
    coordinateSpace: "assembly",
    unit: "mm",
    selection,
    locks: ["body-fixed-region"],
    grid: {
      dimensions,
      cellSize: TOPOLOGY_CELL_SIZE,
      anchor: {
        position: TOPOLOGY_ANCHOR,
        orientation: [0, 0, 0, 1],
      },
    },
    interfaces: {
      preservedMounts: assembly.preservedMounts.length,
      keepOuts: assembly.obstacleVolumes.length,
    },
    inventory: {
      status: evaluation.status,
      shortages: evaluation.shortages.slice(0, shortageLimit),
      shortageCount: evaluation.shortages.length,
      omittedShortageCount: Math.max(0, evaluation.shortages.length - shortageLimit),
    },
  });
}
