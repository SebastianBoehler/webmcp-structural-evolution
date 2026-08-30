import type { DesignDocument } from "../document-schema";
import type { SemanticTopology } from "../rebuild-payload";
import { matchTopologyReference, type TopologyCandidate } from "./persistent-references";
import { CadRebuildError } from "./rebuild-errors";

export interface ResolvedNamedSelection {
  readonly selectionId: string;
  readonly topologyId: string;
}

type SelectionDocument = Pick<DesignDocument, "namedSelections" | "mates">;

function affectedConsumers(document: SelectionDocument, selectionId: string): string[] {
  const consumers = [`named-selection:${selectionId}`];
  for (const mate of document.mates) {
    if (mate.firstSelectionId === selectionId || mate.secondSelectionId === selectionId) {
      consumers.push(`mate:${mate.id}`);
    }
  }
  return consumers.sort();
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
    const affected = affectedConsumers(document, selection.id);
    throw new CadRebuildError(
      "reference-requires-repair",
      `${match.error.message}; affected consumers: ${affected.join(", ")}`,
      affected,
    );
  });
}
