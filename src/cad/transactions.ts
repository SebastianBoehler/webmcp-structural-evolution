import { z } from "zod";

import {
  DesignTransactionSchema,
  type ChangedReference,
  type DesignPrecondition,
  type DesignTransaction,
} from "./command-schema";
import {
  defineDesignDocument,
  normalizeParameterValue,
  type DesignDocument,
} from "./document-schema";
import { applyDesignCommand, type MutableDesignDocument } from "./transaction-commands";
import { addDependentReferences } from "./transaction-dependencies";

export type TransactionDiagnostic = Readonly<{
  code: "invalid-transaction" | "stale-revision" | "precondition-failed" | "command-failed";
  message: string;
  commandId?: string;
}>;

export type DesignTransactionResult =
  | Readonly<{
    ok: true;
    document: DesignDocument;
    changedReferences: readonly ChangedReference[];
    diagnostics: readonly TransactionDiagnostic[];
  }>
  | Readonly<{
    ok: false;
    code: TransactionDiagnostic["code"];
    diagnostics: readonly TransactionDiagnostic[];
  }>;

function failure(
  code: TransactionDiagnostic["code"],
  message: string,
  commandId?: string,
): DesignTransactionResult {
  return { ok: false, code, diagnostics: [{ code, message, ...(commandId ? { commandId } : {}) }] };
}

function contentOf(document: DesignDocument): Omit<DesignDocument, "revision"> {
  const { revision: _revision, ...content } = document;
  return content;
}

function referenceExists(document: DesignDocument, reference: string): boolean {
  const [kind, id] = reference.split(":");
  const collections = {
    parameter: document.parameters,
    frame: document.frames,
    sketch: document.sketches,
    feature: document.features,
    body: document.bodies,
    component: document.components,
    instance: document.instances,
    mate: document.mates,
    "named-selection": document.namedSelections,
    material: document.materials,
    study: document.studies,
  };
  return kind === "document"
    ? id === document.id
    : collections[kind as keyof typeof collections]?.some((value) => value.id === id) ?? false;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function preconditionFails(document: DesignDocument, precondition: DesignPrecondition): string | undefined {
  if (precondition.type === "reference-exists") {
    return referenceExists(document, precondition.reference)
      ? undefined
      : `Reference does not exist: ${precondition.reference}`;
  }
  const parameter = document.parameters.find(({ id }) => id === precondition.parameterId);
  return parameter && valuesEqual(parameter.value, normalizeParameterValue(precondition.value))
    ? undefined
    : `Parameter does not equal expected value: ${precondition.parameterId}`;
}

export async function applyDesignTransaction(
  document: DesignDocument,
  input: unknown,
): Promise<DesignTransactionResult> {
  const parsed = DesignTransactionSchema.safeParse(input);
  if (!parsed.success) return failure("invalid-transaction", z.prettifyError(parsed.error));
  const transaction: DesignTransaction = parsed.data;
  if (transaction.expectedRevision !== document.revision) {
    return failure("stale-revision", "Expected revision does not match the document revision");
  }
  for (const precondition of transaction.preconditions) {
    const message = preconditionFails(document, precondition);
    if (message) return failure("precondition-failed", message);
  }

  const working = structuredClone(contentOf(document)) as MutableDesignDocument;
  const changed = new Set<ChangedReference>();
  for (const command of transaction.commands) {
    const message = applyDesignCommand(working, command, changed);
    if (message) return failure("command-failed", message, command.id);
  }
  try {
    const next = await defineDesignDocument(working);
    if (next.revision === document.revision) {
      return { ok: true, document, changedReferences: [], diagnostics: [] };
    }
    addDependentReferences(next, changed);
    return { ok: true, document: next, changedReferences: [...changed].sort(), diagnostics: [] };
  } catch (error) {
    return failure("command-failed", error instanceof Error ? error.message : "Command validation failed");
  }
}
