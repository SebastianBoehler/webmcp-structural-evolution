import { defineActionReceipt, type ActionReceipt } from "../domain/receipts";
import { revisionId } from "../domain/revisions";
import { freezeSnapshot, type DeepReadonly } from "../domain/snapshots";
import { createArtifactIndex, type ArtifactIndex, type ArtifactRecord } from "./artifact-contract";
import { invalidateArtifacts } from "./artifact-invalidation";
import { DesignTransactionSchema, type DesignTransaction } from "./command-schema";
import {
  checkoutDesignRevision,
  commitDesignRevision,
  createDesignHistory,
  type DesignHistory,
} from "./design-history";
import type { DesignDocument } from "./document-schema";
import { applyDesignTransaction, type DesignTransactionResult } from "./transactions";

export type DesignSession = DeepReadonly<{
  history: DesignHistory;
  artifacts: {
    index: ArtifactIndex;
    invalidatedIds: readonly string[];
  };
  receipts: readonly ActionReceipt[];
}>;

export type DesignSessionClock = Readonly<{
  now: () => string;
  elapsedMs: () => number;
}>;

export type DesignSessionApplication = DeepReadonly<{
  session: DesignSession;
  result: DesignTransactionResult;
}>;

export type DesignSessionInspection = DeepReadonly<{
  documentId: string;
  headRevision: string;
  acceptedRevision: string;
  parameterCount: number;
  frameCount: number;
  branchCount: number;
  artifactCount: number;
  invalidatedArtifactCount: number;
  units: DesignDocument["units"];
}>;

function currentDocument(session: DesignSession): DesignDocument {
  return session.history.documents[session.history.headRevision];
}

function errorMessage(result: DesignTransactionResult): string {
  return result.ok ? "" : result.diagnostics.map(({ message }) => message).join("; ");
}

async function createReceipt(
  transaction: unknown,
  result: DesignTransactionResult,
  clock: DesignSessionClock,
): Promise<ActionReceipt> {
  const parsedTransaction = DesignTransactionSchema.safeParse(transaction);
  const validatedTransaction = parsedTransaction.success ? parsedTransaction.data : null;
  const createdAt = clock.now();
  const affectedRevision = result.ok ? result.document.revision : null;
  const changed = result.ok && result.changedReferences.length > 0;
  const outcome: ActionReceipt["outcome"] = result.ok
    ? { status: "succeeded", result: { revision: result.document.revision, changed } }
    : { status: "failed", error: errorMessage(result) };
  const id = await revisionId({
    action: "apply_design_transaction",
    transactionId: validatedTransaction?.id ?? null,
    affectedRevision,
    outcome,
    createdAt,
  });

  return defineActionReceipt({
    id,
    action: "apply_design_transaction",
    validatedInputs: validatedTransaction,
    affectedRevision,
    outcome,
    duration: { value: Math.max(0, clock.elapsedMs()), unit: "ms" },
    createdAt,
  });
}

export function createDesignSession(
  document: DesignDocument,
  artifacts: readonly ArtifactRecord[] = [],
): DesignSession {
  return freezeSnapshot({
    history: createDesignHistory(document),
    artifacts: {
      index: createArtifactIndex(document.revision, artifacts),
      invalidatedIds: [],
    },
    receipts: [],
  });
}

export function attachDesignSessionArtifacts(
  session: DesignSession,
  artifacts: readonly ArtifactRecord[],
): DesignSession {
  const document = currentDocument(session);
  if (artifacts.some(({ sourceRevision }) => sourceRevision !== document.revision)) {
    throw new Error("Cannot attach a stale artifact to the active design revision");
  }
  const combined = [...session.artifacts.index.artifacts, ...artifacts];
  return freezeSnapshot({
    ...session,
    artifacts: {
      index: createArtifactIndex(document.revision, combined),
      invalidatedIds: session.artifacts.invalidatedIds,
    },
  });
}

export async function applyDesignSessionTransaction(
  session: DesignSession,
  transaction: DesignTransaction,
  clock: DesignSessionClock,
): Promise<DesignSessionApplication> {
  const result = await applyDesignTransaction(currentDocument(session), transaction);
  const receipt = await createReceipt(transaction, result, clock);

  if (!result.ok) {
    return freezeSnapshot({
      session: { ...session, receipts: [...session.receipts, receipt] },
      result,
    });
  }

  if (result.document.revision === session.history.headRevision) {
    return freezeSnapshot({
      session: { ...session, receipts: [...session.receipts, receipt] },
      result,
    });
  }

  const artifacts = invalidateArtifacts(
    session.artifacts.index,
    result.changedReferences,
    result.document.revision,
  );
  const history = session.history.nodes[result.document.revision]
    ? checkoutDesignRevision(session.history, result.document.revision)
    : commitDesignRevision(
        session.history,
        transaction.expectedRevision,
        transaction.id,
        result.document,
      );
  return freezeSnapshot({
    session: {
      history,
      artifacts,
      receipts: [...session.receipts, receipt],
    },
    result,
  });
}

export function inspectDesignSession(session: DesignSession): DesignSessionInspection {
  const document = currentDocument(session);
  const parentRevisions = new Set(
    Object.values(session.history.nodes)
      .map((node) => node.parentRevision)
      .filter((revision): revision is string => revision !== null),
  );
  const branchCount = Object.keys(session.history.nodes)
    .filter((revision) => !parentRevisions.has(revision))
    .length;

  return freezeSnapshot({
    documentId: document.id,
    headRevision: session.history.headRevision,
    acceptedRevision: session.history.acceptedRevision,
    parameterCount: document.parameters.length,
    frameCount: document.frames.length,
    branchCount,
    artifactCount: session.artifacts.index.artifacts.length,
    invalidatedArtifactCount: session.artifacts.invalidatedIds.length,
    units: { ...document.units },
  });
}
