import type { ArtifactRecord } from "../cad/artifact-contract";
import { CAD_RESOURCE_LIMITS } from "../cad/cad-resource-limits";
import {
  assertBodyDynamicsCoverage,
  type BodyDynamicsPayload,
} from "../cad/body-dynamics-payload";
import type { DesignDocument } from "../cad/document-schema";
import {
  captureFixedOwnedPayload,
} from "../cad/fixed-owned-payload";
import {
  assertMechanismExactSuccessPayloads,
  MECHANISM_EXACT_OUTPUTS,
} from "../cad/mechanism-exact-payload";
import type { OpaqueBytesPayload, SemanticMeshPayload } from "../cad/rebuild-payload";
import {
  CadEvaluationEventSchema,
  defineCadEvaluationRequest,
  type CadEvaluationEvent,
} from "../cad/runtime-contracts";
import { evaluateMechanismExactRequest } from "./mechanism-exact-worker";

interface MechanismExactSource {
  readonly brepArtifact: ArtifactRecord;
  readonly brepPayload: OpaqueBytesPayload;
  readonly semanticArtifact: ArtifactRecord;
  readonly semanticMeshPayload: SemanticMeshPayload;
  readonly bodyDynamics: BodyDynamicsPayload;
}

function abortError(): DOMException {
  return new DOMException("Exact mechanism rebuild was cancelled", "AbortError");
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "invalid evidence";
}

function assertArtifactLineage(artifact: ArtifactRecord, document: DesignDocument): void {
  const expected = new Set([
    `document:${document.id}`,
    ...document.parameters.map(({ id }) => `parameter:${id}`),
    ...document.features.map(({ id }) => `feature:${id}`),
    ...document.bodies.map(({ id }) => `body:${id}`),
    ...document.components.map(({ id }) => `component:${id}`),
  ]);
  const actual = artifact.dependencies.map((dependency) =>
    dependency.kind === "entity" ? dependency.reference : `artifact:${dependency.artifactId}`);
  if (actual.length !== expected.size || actual.some((dependency) => !expected.has(dependency))) {
    throw new Error("Exact mechanism artifact lineage does not match the canonical document");
  }
}

function ownsRequestedOutputs(event: Extract<CadEvaluationEvent, { state: "succeeded" }>): boolean {
  return MECHANISM_EXACT_OUTPUTS.length === event.requestedOutputs.length
    && MECHANISM_EXACT_OUTPUTS.every((output, index) => event.requestedOutputs[index] === output);
}

async function validTerminal(value: unknown, signal: AbortSignal): Promise<CadEvaluationEvent> {
  try {
    const terminal = await CadEvaluationEventSchema.parseAsync(value);
    if (signal.aborted) throw abortError();
    return terminal;
  } catch (error) {
    if (signal.aborted) throw abortError();
    throw new Error(`Exact mechanism rebuild returned invalid terminal evidence: ${messageFor(error)}`);
  }
}

export async function rebuildMechanismExactSource(
  document: DesignDocument,
  signal: AbortSignal,
): Promise<MechanismExactSource> {
  if (signal.aborted) throw abortError();
  const requestId = `mechanism-exact-source-${crypto.randomUUID()}`;
  const request = await defineCadEvaluationRequest({
    requestId,
    document,
    sourceRevision: document.revision,
    requestedOutputs: MECHANISM_EXACT_OUTPUTS,
    settings: { consumer: "mechanism-exact-source-v1" },
  });
  if (signal.aborted) throw abortError();
  const terminals: unknown[] = [];
  await evaluateMechanismExactRequest(request, signal, (event) => {
    if (event.state !== "progress") terminals.push(event);
  });
  if (signal.aborted) throw abortError();
  if (terminals.length !== 1) {
    throw new Error("Exact mechanism rebuild emitted an invalid terminal sequence");
  }
  const rawTerminal = terminals[0];
  if (rawTerminal && typeof rawTerminal === "object"
    && (rawTerminal as { state?: unknown }).state === "succeeded") {
    assertMechanismExactSuccessPayloads(rawTerminal);
  }
  const terminal = await validTerminal(rawTerminal, signal);
  if (signal.aborted) throw abortError();
  if (terminal.state === "cancelled") throw abortError();
  if (terminal.state === "failed") {
    throw new Error(`Exact mechanism rebuild failed (${terminal.error.code}): ${terminal.error.message}`);
  }
  if (terminal.state !== "succeeded" || terminal.requestId !== requestId
    || terminal.sourceRevision !== request.sourceRevision || !ownsRequestedOutputs(terminal)) {
    throw new Error("Exact mechanism rebuild did not return a same-request same-revision success");
  }
  const brep = terminal.results.find(({ output }) => output === "brep");
  const semantic = terminal.results.find(({ output }) => output === "semantic-mesh");
  const dynamics = terminal.results.find(({ output }) => output === "body-dynamics");
  if (!brep || brep.output !== "brep" || !semantic || semantic.output !== "semantic-mesh"
    || !dynamics || dynamics.output !== "body-dynamics") {
    throw new Error("Exact mechanism rebuild omitted a required exact output");
  }
  assertBodyDynamicsCoverage(dynamics.payload, request.document.bodies.map(({ id }) => id));
  assertArtifactLineage(brep.artifact, request.document);
  assertArtifactLineage(semantic.artifact, request.document);
  assertMechanismExactSuccessPayloads(terminal);
  if (signal.aborted) throw abortError();
  const owned = captureFixedOwnedPayload({
    brep: brep.payload,
    semantic: semantic.payload,
    dynamics: dynamics.payload,
  }, {
    resource: "mechanism exact source bytes",
    limit: CAD_RESOURCE_LIMITS.mechanismExactSourceBytes,
  });
  if (signal.aborted) throw abortError();
  return Object.freeze({
    brepArtifact: brep.artifact,
    get brepPayload() { return captureFixedOwnedPayload(owned.brep); },
    semanticArtifact: semantic.artifact,
    get semanticMeshPayload() { return captureFixedOwnedPayload(owned.semantic); },
    get bodyDynamics() { return captureFixedOwnedPayload(owned.dynamics); },
  });
}
