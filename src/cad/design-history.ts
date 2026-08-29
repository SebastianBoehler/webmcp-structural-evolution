import { freezeSnapshot, type DeepReadonly } from "../domain/snapshots";
import type { DesignDocument } from "./document-schema";

export type DesignRevision = DeepReadonly<{
  revision: string;
  parentRevision: string | null;
  transactionId: string | null;
}>;

export type DesignHistory = DeepReadonly<{
  documents: Readonly<Record<string, DesignDocument>>;
  nodes: Readonly<Record<string, DesignRevision>>;
  headRevision: string;
  acceptedRevision: string;
}>;

function knownRevision(history: DesignHistory, revision: string): void {
  if (!history.nodes[revision]) throw new Error(`Unknown revision: ${revision}`);
}

function freezeHistory(
  documents: Record<string, DesignDocument>,
  nodes: Record<string, DesignRevision>,
  headRevision: string,
  acceptedRevision: string,
): DesignHistory {
  return freezeSnapshot({ documents, nodes, headRevision, acceptedRevision });
}

export function createDesignHistory(root: DesignDocument): DesignHistory {
  const rootNode: DesignRevision = freezeSnapshot({
    revision: root.revision,
    parentRevision: null,
    transactionId: null,
  });
  return freezeHistory(
    { [root.revision]: root },
    { [root.revision]: rootNode },
    root.revision,
    root.revision,
  );
}

export function commitDesignRevision(
  history: DesignHistory,
  parent: string,
  transactionId: string,
  document: DesignDocument,
): DesignHistory {
  if (!history.nodes[parent]) throw new Error(`Unknown parent revision: ${parent}`);
  if (history.nodes[document.revision]) throw new Error("Commit requires a new document revision");

  const node: DesignRevision = freezeSnapshot({
    revision: document.revision,
    parentRevision: parent,
    transactionId,
  });
  return freezeHistory(
    { ...history.documents, [document.revision]: document },
    { ...history.nodes, [document.revision]: node },
    document.revision,
    history.acceptedRevision,
  );
}

export function checkoutDesignRevision(history: DesignHistory, revision: string): DesignHistory {
  knownRevision(history, revision);
  return freezeHistory({ ...history.documents }, { ...history.nodes }, revision, history.acceptedRevision);
}

export function acceptDesignRevision(history: DesignHistory, revision: string): DesignHistory {
  knownRevision(history, revision);
  return freezeHistory({ ...history.documents }, { ...history.nodes }, history.headRevision, revision);
}

export function parentRevision(history: DesignHistory, revision: string): string | null {
  knownRevision(history, revision);
  return history.nodes[revision].parentRevision;
}

export function childRevisions(history: DesignHistory, parent: string): readonly string[] {
  knownRevision(history, parent);
  return Object.values(history.nodes)
    .filter((node) => node.parentRevision === parent)
    .map((node) => node.revision)
    .sort();
}
