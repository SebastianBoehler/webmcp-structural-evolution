import type { ArtifactRecord } from "../cad/artifact-contract";
import type { DesignTransaction } from "../cad/command-schema";
import type { DesignDocument } from "../cad/document-schema";
import { createDesignSession, applyDesignSessionTransaction } from "../cad/design-session";
import { encodeCadOutputPayload } from "../cad/rebuild-payload";
import {
  defineCadEvaluationRequest,
  CadEvaluationEventSchema,
  type CadEvaluationEvent,
  type CadKernelAdapter,
  type CadOutput,
} from "../cad/runtime-contracts";
import type { JsonValue } from "../domain/canonical-json";
import type { DesignSessionClock } from "../cad/design-session";
import type { ArtifactStore, ArtifactStoreBatchEntry } from "../engineering/artifact-store";
import type { TransactionPreview } from "./workspace-inspection";

export class WorkspaceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export type RebuildRequest = Readonly<{
  requestId: string;
  expectedRevision: string;
  outputs: readonly CadOutput[];
  settings: JsonValue;
}>;

export type DryRunRequest = Readonly<{
  transaction: DesignTransaction;
  outputs: readonly CadOutput[];
  settings: JsonValue;
}>;

export type CadEvaluation = Readonly<{
  artifacts: readonly ArtifactRecord[];
  inputs: readonly ArtifactStoreBatchEntry[];
  exportPayloads: ReadonlyMap<string, Uint8Array>;
}>;

function aborted(signal: AbortSignal): never {
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Workspace CAD evaluation was aborted", "AbortError");
}

export async function evaluateCad(
  adapter: CadKernelAdapter,
  document: DesignDocument,
  request: RebuildRequest,
  signal: AbortSignal,
): Promise<CadEvaluation> {
  if (signal.aborted) aborted(signal);
  const evaluation = await defineCadEvaluationRequest({
    requestId: request.requestId,
    document,
    sourceRevision: request.expectedRevision,
    requestedOutputs: request.outputs,
    settings: request.settings,
  });
  let terminal: Exclude<CadEvaluationEvent, { state: "progress" }> | undefined;
  let terminalProtocolError: WorkspaceError | undefined;
  await adapter.evaluate(evaluation, signal, (event) => {
    if (event.state === "progress") return;
    if (terminal) {
      terminalProtocolError = new WorkspaceError("multiple-cad-terminals", "CAD adapter emitted multiple terminal events");
      return;
    }
    terminal = event;
  });
  if (signal.aborted) aborted(signal);
  if (terminalProtocolError) throw terminalProtocolError;
  if (!terminal) throw new WorkspaceError("cad-no-terminal", "CAD adapter completed without a terminal event");
  const validatedTerminal = await CadEvaluationEventSchema.parseAsync(terminal);
  if (validatedTerminal.state === "progress") {
    throw new WorkspaceError("cad-no-terminal", "CAD adapter completed without a terminal event");
  }
  terminal = validatedTerminal;
  if (terminal.requestId !== evaluation.requestId) {
    throw new WorkspaceError("cad-binding-mismatch", "CAD terminal request binding does not match the evaluation request");
  }
  if (terminal.state === "cancelled") aborted(signal);
  if (terminal.state === "failed") throw new WorkspaceError(terminal.error.code, terminal.error.message);
  if (terminal.sourceRevision !== document.revision
    || terminal.requestedOutputs.length !== evaluation.requestedOutputs.length
    || terminal.requestedOutputs.some((output, index) => output !== evaluation.requestedOutputs[index])) {
    throw new WorkspaceError("stale-revision", "CAD result does not match the evaluated revision");
  }
  const generated = terminal.results.filter(
    (result): result is typeof result & { artifact: ArtifactRecord } => "artifact" in result,
  );
  const inputs = generated.map((result) => ({
    record: result.artifact,
    payload: encodeCadOutputPayload(result.payload),
  }));
  const exportPayloads = new Map<string, Uint8Array>();
  for (const result of generated) {
    if (result.output === "step") exportPayloads.set(result.artifact.id, result.payload.bytes.slice());
  }
  return { artifacts: generated.map(({ artifact }) => artifact), inputs, exportPayloads };
}

export async function runDryRun(
  document: DesignDocument,
  request: DryRunRequest,
  signal: AbortSignal,
  createAdapter: () => CadKernelAdapter,
  createStore: () => ArtifactStore,
  clock: DesignSessionClock,
): Promise<TransactionPreview> {
  const adapter = createAdapter();
  try {
    const applied = await applyDesignSessionTransaction(
      createDesignSession(document), request.transaction, clock,
    );
    if (!applied.result.ok) throw new WorkspaceError(applied.result.code, applied.result.diagnostics[0]?.message ?? "Dry-run failed");
    const preview = applied.result.document;
    const store = createStore();
    const evaluated = await evaluateCad(adapter, preview, {
      requestId: `dry-run:${request.transaction.id}`,
      expectedRevision: preview.revision,
      outputs: request.outputs,
      settings: request.settings,
    }, signal);
    await store.commit(evaluated.inputs, () => !signal.aborted);
    return {
      sourceRevision: document.revision,
      previewRevision: preview.revision,
      changed: preview.revision !== document.revision,
      changedReferences: applied.result.changedReferences,
      outputs: request.outputs,
      artifacts: evaluated.artifacts,
    };
  } finally { adapter.dispose?.(); }
}
