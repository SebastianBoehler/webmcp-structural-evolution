import { z } from "zod";

import {
  DesignTransactionSchema,
  type ChangedReference,
  type DesignCommand,
  type DesignPrecondition,
  type DesignTransaction,
} from "./command-schema";
import {
  defineDesignDocument,
  normalizeParameterValue,
  type DesignDocument,
} from "./document-schema";

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

type MutableDocument = {
  -readonly [Key in keyof DesignDocument]: DesignDocument[Key];
};

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
  return kind === "document"
    ? id === document.id
    : kind === "parameter"
      ? document.parameters.some((parameter) => parameter.id === id)
      : document.frames.some((frame) => frame.id === id);
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

function applyCommand(
  document: MutableDocument,
  command: DesignCommand,
  changed: Set<ChangedReference>,
): string | undefined {
  switch (command.type) {
    case "rename-document":
      document.label = command.label;
      changed.add(`document:${document.id}`);
      return undefined;
    case "define-parameter":
      if (document.parameters.some(({ id }) => id === command.parameter.id)) return "Parameter already exists";
      document.parameters = [...document.parameters, command.parameter];
      changed.add(`parameter:${command.parameter.id}`);
      return undefined;
    case "set-parameter": {
      const index = document.parameters.findIndex(({ id }) => id === command.parameterId);
      if (index === -1) return "Parameter does not exist";
      const parameter = document.parameters[index];
      document.parameters = document.parameters.map((entry, entryIndex) => entryIndex === index
        ? { ...parameter, value: command.value }
        : entry);
      changed.add(`parameter:${command.parameterId}`);
      return undefined;
    }
    case "remove-parameter":
      if (!document.parameters.some(({ id }) => id === command.parameterId)) return "Parameter does not exist";
      document.parameters = document.parameters.filter(({ id }) => id !== command.parameterId);
      changed.add(`parameter:${command.parameterId}`);
      return undefined;
    case "define-frame":
      if (document.frames.some(({ id }) => id === command.frame.id)) return "Frame already exists";
      document.frames = [...document.frames, command.frame];
      changed.add(`frame:${command.frame.id}`);
      return undefined;
  }
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

  const working = structuredClone(contentOf(document)) as MutableDocument;
  const changed = new Set<ChangedReference>();
  for (const command of transaction.commands) {
    const message = applyCommand(working, command, changed);
    if (message) return failure("command-failed", message, command.id);
  }

  try {
    const next = await defineDesignDocument(working);
    if (next.revision === document.revision) {
      return { ok: true, document, changedReferences: [], diagnostics: [] };
    }
    return { ok: true, document: next, changedReferences: [...changed].sort(), diagnostics: [] };
  } catch (error) {
    return failure("command-failed", error instanceof Error ? error.message : "Command validation failed");
  }
}
