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
  };
  return kind === "document" ? id === document.id : collections[kind as keyof typeof collections]?.some((value) => value.id === id) ?? false;
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
    case "define-sketch":
      if (document.sketches.some(({ id }) => id === command.sketch.id)) return "Sketch already exists";
      document.sketches = [...document.sketches, command.sketch];
      changed.add(`sketch:${command.sketch.id}`);
      return undefined;
    case "define-feature":
      if (document.features.some(({ id }) => id === command.feature.id)) return "Feature already exists";
      document.features = [...document.features, command.feature];
      changed.add(`feature:${command.feature.id}`);
      return undefined;
    case "remove-feature":
      if (!document.features.some(({ id }) => id === command.featureId)) return "Feature does not exist";
      if (document.bodies.some((body) => body.featureId === command.featureId)
        || document.features.some((feature) => (feature.kind === "extrude" || feature.kind === "revolve") ? false : feature.leftFeatureId === command.featureId || feature.rightFeatureId === command.featureId)) return "Feature has consumers";
      document.features = document.features.filter(({ id }) => id !== command.featureId);
      changed.add(`feature:${command.featureId}`);
      return undefined;
    case "define-body":
      if (document.bodies.some(({ id }) => id === command.body.id)) return "Body already exists";
      document.bodies = [...document.bodies, command.body];
      changed.add(`body:${command.body.id}`);
      return undefined;
    case "define-component":
      if (document.components.some(({ id }) => id === command.component.id)) return "Component already exists";
      document.components = [...document.components, command.component];
      changed.add(`component:${command.component.id}`);
      return undefined;
    case "place-instance":
      if (document.instances.some(({ id }) => id === command.instance.id)) return "Instance already exists";
      document.instances = [...document.instances, command.instance];
      changed.add(`instance:${command.instance.id}`);
      return undefined;
    case "define-mate":
      if (document.mates.some(({ id }) => id === command.mate.id)) return "Mate already exists";
      document.mates = [...document.mates, command.mate];
      changed.add(`mate:${command.mate.id}`);
      return undefined;
    case "define-named-selection":
      if (document.namedSelections.some(({ id }) => id === command.namedSelection.id)) return "Named selection already exists";
      document.namedSelections = [...document.namedSelections, command.namedSelection];
      changed.add(`named-selection:${command.namedSelection.id}`);
      return undefined;
  }
}

function addDependentReferences(document: DesignDocument, changed: Set<ChangedReference>): void {
  let added = true;
  while (added) {
    added = false;
    const add = (reference: ChangedReference) => {
      if (!changed.has(reference)) {
        changed.add(reference);
        added = true;
      }
    };
    for (const feature of document.features) {
      if ((feature.kind === "extrude" || feature.kind === "revolve") && changed.has(`sketch:${feature.sketchId}`)) add(`feature:${feature.id}`);
      if (feature.kind !== "extrude" && feature.kind !== "revolve"
        && (changed.has(`feature:${feature.leftFeatureId}`) || changed.has(`feature:${feature.rightFeatureId}`))) add(`feature:${feature.id}`);
    }
    for (const body of document.bodies) if (changed.has(`feature:${body.featureId}`)) add(`body:${body.id}`);
    for (const component of document.components) if (component.bodyIds.some((bodyId) => changed.has(`body:${bodyId}`))) add(`component:${component.id}`);
    for (const instance of document.instances) if (changed.has(`component:${instance.componentId}`)) add(`instance:${instance.id}`);
    for (const selection of document.namedSelections) if (changed.has(`body:${selection.bodyId}`)) add(`named-selection:${selection.id}`);
    for (const mate of document.mates) if (
      changed.has(`instance:${mate.firstInstanceId}`) || changed.has(`instance:${mate.secondInstanceId}`)
      || changed.has(`named-selection:${mate.firstSelectionId}`) || changed.has(`named-selection:${mate.secondSelectionId}`)
    ) add(`mate:${mate.id}`);
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
    addDependentReferences(next, changed);
    return { ok: true, document: next, changedReferences: [...changed].sort(), diagnostics: [] };
  } catch (error) {
    return failure("command-failed", error instanceof Error ? error.message : "Command validation failed");
  }
}
