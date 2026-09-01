import type { SemanticDocumentArtifact, SemanticNode } from "./semantic-scene";

export interface SelectionRepair { readonly selection: string | undefined; readonly repaired: boolean; readonly invalidated?: boolean }

function nodesById(document: SemanticDocumentArtifact): ReadonlyMap<string, SemanticNode> {
  return new Map(document.nodes.map((node) => [node.id, node]));
}

export function semanticPathFor(document: SemanticDocumentArtifact, selection: string): readonly string[] {
  const nodes = nodesById(document);
  const path: string[] = [];
  let current = nodes.get(selection);
  while (current) {
    path.unshift(current.id);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return path;
}

function owningComponent(document: SemanticDocumentArtifact, selection: string): SemanticNode | undefined {
  const nodes = nodesById(document);
  let current = nodes.get(selection);
  if (current?.ownerComponentId) return nodes.get(current.ownerComponentId);
  while (current && current.kind !== "component") {
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return current?.kind === "component" ? current : undefined;
}

export function sourceSelectionForSemantic(
  document: SemanticDocumentArtifact,
  selection: string,
): string | undefined {
  return owningComponent(document, selection)?.sourceSelectionId;
}

export function componentIdForSourceSelection(
  document: SemanticDocumentArtifact,
  sourceSelectionId: string,
): string | undefined {
  return document.nodes.find((node) => node.kind === "component"
    && node.sourceSelectionId === sourceSelectionId)?.id;
}

export function repairSemanticSelection(
  selection: string | undefined,
  document: SemanticDocumentArtifact,
  replacements: Readonly<Record<string, string>> = {},
): SelectionRepair {
  if (!selection) return { selection, repaired: false };
  const nodes = nodesById(document);
  if (nodes.has(selection)) return { selection, repaired: false };
  const replacement = replacements[selection];
  if (replacement && nodes.has(replacement)) return { selection: replacement, repaired: true };
  return { selection: undefined, repaired: false, invalidated: true };
}
