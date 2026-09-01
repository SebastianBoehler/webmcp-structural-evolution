import { defineArtifactRecord, type ArtifactRecord } from "../cad/artifact-contract";
import { assertBodyDynamicsCoverage, type BodyDynamicsPayload } from "../cad/body-dynamics-payload";
import type { DesignDocument } from "../cad/document-schema";
import { captureFixedOwnedPayload } from "../cad/fixed-owned-payload";
import {
  digestCadOutputPayload, encodeCadOutputPayload, type OpaqueBytesPayload, type SemanticMeshPayload,
} from "../cad/rebuild-payload";
import type { ArtifactStoreBatchEntry } from "../engineering/artifact-store";
import { revisionId } from "../domain/revisions";
import {
  CadEvaluationEventSchema, defineCadEvaluationRequest, type CadEvaluationEvent,
  type CadKernelAdapter,
} from "../cad/runtime-contracts";

const EXACT_COMPONENT_OUTPUTS = ["brep", "semantic-mesh", "body-dynamics"] as const;

export interface ExactComponentSource {
  readonly document: DesignDocument;
  readonly sourceRevision: string;
  readonly brepArtifact: ArtifactRecord;
  readonly brepPayload: OpaqueBytesPayload;
  readonly semanticArtifact: ArtifactRecord;
  readonly semanticMeshPayload: SemanticMeshPayload;
  readonly bodyDynamics: BodyDynamicsPayload;
  readonly bodyDynamicsArtifact: ArtifactRecord;
  readonly bodyBreps: Readonly<Record<string, Readonly<{
    artifact: ArtifactRecord;
    payload: OpaqueBytesPayload;
  }>>>;
  readonly artifacts: readonly [ArtifactRecord, ArtifactRecord];
  readonly allArtifacts: readonly ArtifactRecord[];
  readonly entries: readonly ArtifactStoreBatchEntry[];
}

const abort = (signal: AbortSignal): never => {
  throw signal.reason instanceof Error
    ? signal.reason : new DOMException("Exact component acquisition was cancelled", "AbortError");
};

function requiredEntities(document: DesignDocument): ReadonlySet<string> {
  return new Set([
    `document:${document.id}`,
    ...document.parameters.map(({ id }) => `parameter:${id}`),
    ...document.features.map(({ id }) => `feature:${id}`),
    ...document.bodies.map(({ id }) => `body:${id}`),
    ...document.components.map(({ id }) => `component:${id}`),
  ]);
}

async function assertRoot(
  artifact: ArtifactRecord, payload: OpaqueBytesPayload | SemanticMeshPayload,
  document: DesignDocument, kind: "brep" | "render-mesh", mediaType: string,
): Promise<void> {
  const entities = new Set(artifact.dependencies.flatMap((dependency) =>
    dependency.kind === "entity" ? [dependency.reference] : []));
  if (artifact.kind !== kind || artifact.sourceRevision !== document.revision
    || artifact.units !== "m" || artifact.mediaType !== mediaType
    || artifact.producer.name !== "occt-wasm"
    || [...requiredEntities(document)].some((reference) => !entities.has(reference))
    || await digestCadOutputPayload(payload) !== artifact.contentDigest) {
    throw new Error(`Exact component ${kind} root is not owned by the active document revision`);
  }
}

async function exactBodyBreps(
  document: DesignDocument, root: ArtifactRecord, dynamics: BodyDynamicsPayload,
) {
  const pairs = await Promise.all(dynamics.bodies.map(async (body) => {
    const featureId = document.bodies.find(({ id }) => id === body.bodyId)!.featureId;
    const componentIds = document.components
      .filter(({ bodyIds }) => bodyIds.includes(body.bodyId)).map(({ id }) => id);
    const artifact = await defineArtifactRecord({
      kind: "brep", sourceRevision: document.revision,
      producer: { name: "workspace-exact-body-brep", version: "1.0.0" },
      settingsDigest: await revisionId({ rootArtifactId: root.id, bodyId: body.bodyId }),
      contentDigest: await digestCadOutputPayload(body.brep), units: "m",
      mediaType: "application/vnd.opencascade.brep",
      dependencies: [
        { kind: "artifact" as const, artifactId: root.id },
        { kind: "entity" as const, reference: `document:${document.id}` as const },
        { kind: "entity" as const, reference: `body:${body.bodyId}` as const },
        { kind: "entity" as const, reference: `feature:${featureId}` as const },
        ...componentIds.map((id) => ({ kind: "entity" as const,
          reference: `component:${id}` as const })),
      ],
    });
    return [body.bodyId, Object.freeze({ artifact, payload: body.brep })] as const;
  }));
  return Object.freeze(Object.fromEntries(pairs));
}

async function exactDynamicsRecord(
  document: DesignDocument, roots: readonly [ArtifactRecord, ArtifactRecord], payload: BodyDynamicsPayload,
) {
  return defineArtifactRecord({
    kind: "body-dynamics", sourceRevision: document.revision,
    producer: { name: "workspace-exact-body-dynamics", version: "1.0.0" },
    settingsDigest: await revisionId({ rootArtifactIds: roots.map(({ id }) => id).sort() }),
    contentDigest: await digestCadOutputPayload(payload), units: "m",
    mediaType: "application/vnd.structural-evolution.body-dynamics-v1",
    dependencies: [
      ...[...requiredEntities(document)].map((reference) =>
        ({ kind: "entity" as const, reference: reference as `document:${string}` })),
      ...roots.map(({ id }) => ({ kind: "artifact" as const, artifactId: id })),
    ],
  });
}

export async function acquireExactComponentSource(
  document: DesignDocument, adapter: CadKernelAdapter, signal: AbortSignal,
): Promise<ExactComponentSource> {
  if (signal.aborted) abort(signal);
  const request = await defineCadEvaluationRequest({
    requestId: `exact-component-${crypto.randomUUID()}`,
    document, sourceRevision: document.revision,
    requestedOutputs: EXACT_COMPONENT_OUTPUTS,
    settings: { consumer: "workspace-exact-component-source-v1" },
  });
  const terminals: unknown[] = [];
  await adapter.evaluate(request, signal, (event) => {
    if (event.state !== "progress") terminals.push(event);
  });
  if (signal.aborted) abort(signal);
  if (terminals.length !== 1) throw new Error("Exact component rebuild emitted an invalid terminal sequence");
  const terminal = await CadEvaluationEventSchema.parseAsync(terminals[0]) as CadEvaluationEvent;
  if (terminal.state === "cancelled") abort(signal);
  if (terminal.state === "failed") {
    throw new Error(`Exact component rebuild failed (${terminal.error.code}): ${terminal.error.message}`);
  }
  if (terminal.state !== "succeeded" || terminal.requestId !== request.requestId
    || terminal.sourceRevision !== document.revision
    || terminal.requestedOutputs.some((output, index) => output !== EXACT_COMPONENT_OUTPUTS[index])) {
    throw new Error("Exact component rebuild did not return a same-request same-revision success");
  }
  const brep = terminal.results.find(({ output }) => output === "brep");
  const semantic = terminal.results.find(({ output }) => output === "semantic-mesh");
  const dynamics = terminal.results.find(({ output }) => output === "body-dynamics");
  if (!brep || brep.output !== "brep" || !semantic || semantic.output !== "semantic-mesh"
    || !dynamics || dynamics.output !== "body-dynamics") {
    throw new Error("Exact component rebuild omitted a required exact output");
  }
  await assertRoot(brep.artifact, brep.payload, document, "brep", "application/vnd.opencascade.brep");
  await assertRoot(semantic.artifact, semantic.payload, document, "render-mesh",
    "application/vnd.structural-evolution.semantic-mesh");
  assertBodyDynamicsCoverage(dynamics.payload, document.bodies.map(({ id }) => id));
  const roots = [brep.artifact, semantic.artifact] as const;
  const bodyDynamicsArtifact = await exactDynamicsRecord(document, roots, dynamics.payload);
  const bodyBreps = await exactBodyBreps(document, brep.artifact, dynamics.payload);
  const owned = captureFixedOwnedPayload({
    brep: brep.payload, semantic: semantic.payload, dynamics: dynamics.payload,
    bodyBreps: Object.fromEntries(Object.entries(bodyBreps).map(([id, source]) => [id, source.payload])),
  });
  const ownedBodyBreps = Object.freeze(Object.fromEntries(Object.entries(bodyBreps).map(([id, source]) =>
    [id, Object.freeze({ artifact: source.artifact,
      get payload() { return captureFixedOwnedPayload(owned.bodyBreps[id]!); } })])));
  const bodyArtifacts = Object.values(bodyBreps).map(({ artifact }) => artifact);
  const source = {
    document, sourceRevision: document.revision,
    brepArtifact: brep.artifact,
    get brepPayload() { return captureFixedOwnedPayload(owned.brep); },
    semanticArtifact: semantic.artifact,
    get semanticMeshPayload() { return captureFixedOwnedPayload(owned.semantic); },
    get bodyDynamics() { return captureFixedOwnedPayload(owned.dynamics); },
    bodyDynamicsArtifact,
    bodyBreps: ownedBodyBreps,
    artifacts: Object.freeze([brep.artifact, semantic.artifact]) as readonly [ArtifactRecord, ArtifactRecord],
    allArtifacts: Object.freeze([brep.artifact, semantic.artifact, bodyDynamicsArtifact, ...bodyArtifacts]),
    entries: Object.freeze([
      { record: brep.artifact, payload: encodeCadOutputPayload(owned.brep) },
      { record: semantic.artifact, payload: encodeCadOutputPayload(owned.semantic) },
      { record: bodyDynamicsArtifact, payload: encodeCadOutputPayload(owned.dynamics) },
      ...Object.entries(ownedBodyBreps).map(([id, body]) =>
        ({ record: body.artifact, payload: encodeCadOutputPayload(owned.bodyBreps[id]!) })),
    ]) as readonly ArtifactStoreBatchEntry[],
  };
  return Object.freeze(source);
}
