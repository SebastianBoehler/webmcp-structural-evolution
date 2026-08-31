import type { DesignDocument } from "../document-schema";
import type { SemanticTopology } from "../rebuild-payload";
import {
  matchTopologyReference,
  type TopologyCandidate,
  type TopologySignature,
} from "./persistent-references";
import { CadRebuildError } from "./rebuild-errors";

export interface ResolvedNamedSelection {
  readonly selectionId: string;
  readonly topologyId: string;
}

export type SelectionDocument = Pick<DesignDocument, "namedSelections" | "mates">;

function affectedConsumers(document: SelectionDocument, selectionIds: readonly string[]): string[] {
  const selections = new Set(selectionIds);
  const consumers = new Set(selectionIds.map((selectionId) => `named-selection:${selectionId}`));
  for (const mate of document.mates) {
    if (selections.has(mate.firstSelectionId) || selections.has(mate.secondSelectionId)) {
      consumers.add(`mate:${mate.id}`);
    }
  }
  return [...consumers].sort();
}

export function repairConsumersForTopology(
  document: SelectionDocument,
  bodyId: string,
  kind: TopologySignature["kind"],
  ownerFeatureIds: readonly string[],
): string[] {
  const owners = new Set(ownerFeatureIds);
  const selectionIds = document.namedSelections
    .filter(({ reference }) => reference.bodyId === bodyId
      && reference.expectedKind === kind && owners.has(reference.ownerFeatureId))
    .map(({ id }) => id);
  return affectedConsumers(document, selectionIds);
}

export function resolveNamedSelections(
  document: SelectionDocument,
  topology: readonly SemanticTopology[],
): readonly ResolvedNamedSelection[] {
  return document.namedSelections.map((selection) => {
    const reference = selection.reference;
    const candidates: TopologyCandidate[] = topology
      .filter(({ bodyId, signature }) => bodyId === reference.bodyId
        && signature.kind === reference.expectedKind)
      .map(({ id, signature }) => ({ id, signature }));
    const stable = reference.stableId === undefined
      ? []
      : candidates.filter(({ id, signature }) => id === reference.stableId
        && signature.ownerFeatureId === reference.ownerFeatureId);
    if (stable.length === 1) return { selectionId: selection.id, topologyId: stable[0]!.id };
    const match = matchTopologyReference({
      ownerFeatureId: reference.ownerFeatureId,
      kind: reference.expectedKind,
      ...reference.signature,
    }, candidates);
    if (match.ok) return { selectionId: selection.id, topologyId: match.candidate.id };
    const affected = repairConsumersForTopology(
      document, reference.bodyId, reference.expectedKind, [reference.ownerFeatureId],
    );
    throw new CadRebuildError(
      "reference-requires-repair",
      `${match.error.message}; affected consumers: ${affected.join(", ")}`,
      affected,
    );
  });
}
