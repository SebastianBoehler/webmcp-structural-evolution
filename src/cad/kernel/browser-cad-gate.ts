import type { CadMesh } from "../../assembly/step-import";
import type { ArtifactRecord } from "../artifact-contract";
import {
  applyDesignSessionTransaction, attachDesignSessionArtifacts, createDesignSession,
  type DesignSession,
} from "../design-session";
import { createDesignDocument, type DesignDocument } from "../document-schema";
import { digestCadOutputPayload, type MassPropertiesPayload, type SemanticMeshPayload } from "../rebuild-payload";
import {
  defineCadEvaluationRequest,
  ExactStepImportRequestSchema,
  ExactStepImportResultSchema,
  type CadEvaluationEvent,
  type CadKernelAdapter,
  type CadOutput,
} from "../runtime-contracts";
import { createOcctCadAdapter } from "./occt-adapter";
const OUTPUTS = ["brep", "semantic-mesh", "mass-properties", "step"] as const satisfies readonly CadOutput[];
const RELATIVE_TOLERANCE = 1e-6;
const INITIAL_WIDTH_M = 0.08;
const EDITED_WIDTH_M = 0.1;
type Success = Extract<CadEvaluationEvent, { state: "succeeded" }>;
type OutputResult = Success["results"][number];
export interface ExactCadGateDependencies {
  readonly createAdapter?: () => CadKernelAdapter;
  readonly terminalQuiescenceMs?: number;
  readonly now?: () => number;
}
export interface ExactCadGateResult {
  readonly status: "passed";
  readonly timingsMs: Readonly<Record<"authoring" | "initialRebuild" | "dimensionRebuild" | "stepRoundTrip" | "cancellation" | "finalRebuild" | "total", number>>;
  readonly revisions: { readonly initial: string; readonly dimension: string };
  readonly hashes: {
    readonly initialBrep: string; readonly dimensionBrep: string; readonly finalBrep: string;
    readonly initialStep: string; readonly dimensionStep: string;
  };
  readonly measurements: {
    readonly maximumMassRelativeError: number;
    readonly maximumVolumeRelativeError: number;
    readonly invalidSolidCount: 0;
  };
  readonly stepRoundTrip: {
    readonly expectedEnvelopeMm: readonly [number, number, number];
    readonly importedEnvelopeMm: readonly [number, number, number];
    readonly envelopeRelativeError: number;
  };
  readonly cancellation: {
    readonly outcome: "cancelled"; readonly lateSuccess: false;
    readonly workerDisposition: "quarantined";
  };
  readonly artifacts: { readonly invalidatedCount: number; readonly staleCount: 0; readonly activeCount: number };
  readonly renderMesh: CadMesh;
}
const clock = { now: () => new Date().toISOString(), elapsedMs: () => 0 };
const expectedVolume = (widthM: number) => widthM * 0.04 * 0.01
  + Math.PI * 0.01 ** 2 * 0.01
  - Math.PI * 0.003 ** 2 * 0.02;
const relativeError = (actual: number, expected: number) => Math.abs(actual - expected) / Math.abs(expected);

function documentAtHead(session: DesignSession): DesignDocument {
  return session.history.documents[session.history.headRevision];
}

async function authorDocument(now: () => number) {
  const started = now();
  const root = await createDesignDocument({
    id: "exact-browser-part", label: "Exact browser part",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "agent", id: "browser-cad-gate" },
  });
  const applied = await applyDesignSessionTransaction(createDesignSession(root), {
    id: "author-exact-part", expectedRevision: root.revision,
    actor: { kind: "agent", id: "browser-cad-gate" }, preconditions: [],
    commands: [
      { id: "define-width", type: "define-parameter", parameter: { id: "plate-width", label: "Plate width", value: { kind: "length", value: { value: INITIAL_WIDTH_M, unit: "m" } } } },
      { id: "define-boss-frame", type: "define-frame", frame: { id: "boss-frame", label: "Boss profile", parentId: "world", transform: { position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0.01, unit: "m" } }, orientation: { roll: { value: Math.PI / 2, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } } } } },
      {
        id: "define-plate-sketch", type: "define-sketch",
        sketch: {
          id: "plate-sketch", plane: "frame:world",
          entities: [{ id: "plate-outline", kind: "rectangle", centerM: [0, 0], sizeM: [{ parameterId: "plate-width" }, 0.04] }],
          constraints: [
            { id: "plate-width", kind: "distance", first: { entityId: "plate-outline", point: "left" }, second: { entityId: "plate-outline", point: "right" }, axis: "x", valueM: { parameterId: "plate-width" } },
            { id: "plate-height", kind: "distance", first: { entityId: "plate-outline", point: "bottom" }, second: { entityId: "plate-outline", point: "top" }, axis: "y", valueM: 0.04 },
          ],
        },
      },
      {
        id: "define-boss-sketch", type: "define-sketch",
        sketch: {
          id: "boss-sketch", plane: "frame:boss-frame",
          entities: [{ id: "boss-profile", kind: "rectangle", centerM: [0.005, 0.005], sizeM: [0.01, 0.01] }],
          constraints: [
            { id: "boss-width", kind: "distance", first: { entityId: "boss-profile", point: "left" }, second: { entityId: "boss-profile", point: "right" }, axis: "x", valueM: 0.01 },
            { id: "boss-height", kind: "distance", first: { entityId: "boss-profile", point: "bottom" }, second: { entityId: "boss-profile", point: "top" }, axis: "y", valueM: 0.01 },
          ],
        },
      },
      {
        id: "define-hole-sketch", type: "define-sketch",
        sketch: {
          id: "hole-sketch", plane: "frame:world",
          entities: [{ id: "hole-profile", kind: "circle", centerM: [0, 0], radiusM: 0.003 }],
          constraints: [{ id: "hole-radius", kind: "radius", entityId: "hole-profile", valueM: 0.003 }],
        },
      },
      { id: "define-plate", type: "define-feature", feature: { id: "plate", kind: "extrude", sketchId: "plate-sketch", distanceM: 0.01 } },
      { id: "define-boss", type: "define-feature", feature: { id: "boss", kind: "revolve", sketchId: "boss-sketch", angleRad: Math.PI * 2, axis: { originM: [0, 0], direction: [0, 1] } } },
      { id: "define-join", type: "define-feature", feature: { id: "join", kind: "union", leftFeatureId: "plate", rightFeatureId: "boss" } },
      { id: "define-hole-tool", type: "define-feature", feature: { id: "hole-tool", kind: "extrude", sketchId: "hole-sketch", distanceM: 0.03 } },
      { id: "define-through-cut", type: "define-feature", feature: { id: "through-cut", kind: "cut", leftFeatureId: "join", rightFeatureId: "hole-tool" } },
      { id: "define-finished-body", type: "define-body", body: { id: "finished-body", featureId: "through-cut" } },
    ],
  }, clock);
  if (!applied.result.ok) throw new Error(`Exact CAD authoring failed: ${applied.result.diagnostics[0]?.message}`);
  return { session: applied.session, elapsedMs: now() - started };
}

async function collectEvaluation(
  adapter: CadKernelAdapter,
  document: DesignDocument,
  requestId: string,
  signal: AbortSignal,
  terminalQuiescenceMs = 0,
  onProgress?: () => void,
): Promise<readonly CadEvaluationEvent[]> {
  const request = await defineCadEvaluationRequest({
    requestId, document, sourceRevision: document.revision,
    requestedOutputs: [...OUTPUTS], settings: { gate: "exact-cad-browser-v1" },
  });
  const terminals: CadEvaluationEvent[] = [];
  await adapter.evaluate(request, signal, (event) => {
    if (event.state === "progress") onProgress?.();
    else terminals.push(event);
  });
  if (terminalQuiescenceMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, terminalQuiescenceMs));
  }
  if (terminals.length === 0) throw new Error(`Exact CAD rebuild ${requestId} emitted no terminal event`);
  if (terminals.length > 1) {
    const cancelled = terminals.findIndex(({ state }) => state === "cancelled");
    const lateSuccess = terminals.findIndex(({ state }) => state === "succeeded") > cancelled;
    throw new Error(lateSuccess ? "Exact CAD worker emitted success after cancellation" : `Exact CAD rebuild ${requestId} emitted multiple terminal events`);
  }
  return terminals;
}

function requireSuccess(events: readonly CadEvaluationEvent[]): Success {
  const event = events[0]!;
  if (event.state === "failed") {
    if (event.error.code === "invalid-solid") throw new Error("Exact CAD invalid solid count: 1");
    throw new Error(`Exact CAD worker failed (${event.error.code}): ${event.error.message}`);
  }
  if (event.state === "cancelled") throw new Error("Exact CAD rebuild was unexpectedly cancelled");
  if (event.state === "progress") throw new Error("Exact CAD rebuild emitted progress as its terminal event");
  for (const output of OUTPUTS) {
    if (!event.results.some((result) => result.output === output)) {
      throw new Error(`Exact CAD rebuild missing requested output: ${output}`);
    }
  }
  return event;
}

function resultFor<Output extends CadOutput>(success: Success, output: Output) {
  return success.results.find((result) => result.output === output) as Extract<OutputResult, { output: Output }>;
}

async function verifiedArtifacts(success: Success, revision: string): Promise<readonly ArtifactRecord[]> {
  const artifacts: ArtifactRecord[] = [];
  for (const result of success.results) {
    if (!("artifact" in result)) continue;
    if (result.artifact.sourceRevision !== revision) throw new Error(`Stale CAD artifact for ${result.output}`);
    if (await digestCadOutputPayload(result.payload) !== result.artifact.contentDigest) {
      throw new Error(`CAD artifact digest mismatch for ${result.output}`);
    }
    artifacts.push(result.artifact);
  }
  return artifacts;
}

function renderMesh(payload: SemanticMeshPayload): CadMesh {
  const positions = Float32Array.from(payload.positionsM, (value) => value * 1_000);
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) for (let axis = 0; axis < 3; axis += 1) {
    minimum[axis] = Math.min(minimum[axis]!, positions[index + axis]!);
    maximum[axis] = Math.max(maximum[axis]!, positions[index + axis]!);
  }
  return {
    surfaces: [{ name: "Exact OCCT part", positions, normals: payload.normals.slice(), indices: payload.indices.slice() }],
    sizeMm: maximum.map((value, axis) => value - minimum[axis]!) as [number, number, number],
    triangleCount: payload.indices.length / 3,
    semanticMesh: payload,
  };
}

function validateMass(mass: MassPropertiesPayload, widthM: number) {
  const expected = expectedVolume(widthM);
  return { massError: relativeError(mass.massKg, expected), volumeError: relativeError(mass.volumeM3, expected) };
}

export async function runExactCadGate(
  signal: AbortSignal,
  dependencies: ExactCadGateDependencies = {},
): Promise<ExactCadGateResult> {
  if (signal.aborted) throw new DOMException("Exact CAD gate was cancelled", "AbortError");
  const now = dependencies.now ?? (() => performance.now());
  const started = now(), adapter = (dependencies.createAdapter ?? createOcctCadAdapter)();
  const authored = await authorDocument(now), initialDocument = documentAtHead(authored.session);
  const timed = async <T>(run: () => Promise<T>) => { const mark = now(); const value = await run(); return { value, elapsed: now() - mark }; };
  const initialRun = await timed(async () => requireSuccess(await collectEvaluation(adapter, initialDocument, "initial", signal)));
  const initialArtifacts = await verifiedArtifacts(initialRun.value, initialDocument.revision);
  const indexedSession = createDesignSession(initialDocument, initialArtifacts);
  const edited = await applyDesignSessionTransaction(indexedSession, {
    id: "edit-plate-width", expectedRevision: initialDocument.revision,
    actor: { kind: "agent", id: "browser-cad-gate" }, preconditions: [],
    commands: [{ id: "set-plate-width", type: "set-parameter", parameterId: "plate-width", value: { kind: "length", value: { value: EDITED_WIDTH_M, unit: "m" } } }],
  }, clock);
  if (!edited.result.ok) throw new Error(`Exact CAD dimension edit failed: ${edited.result.diagnostics[0]?.message}`);
  if (edited.session.artifacts.index.artifacts.length > 0) throw new Error("Stale CAD artifacts survived the dimension edit");
  const dimensionDocument = documentAtHead(edited.session);
  const dimensionRun = await timed(async () => requireSuccess(await collectEvaluation(adapter, dimensionDocument, "dimension", signal)));
  const dimensionArtifacts = await verifiedArtifacts(dimensionRun.value, dimensionDocument.revision);
  let activeSession = attachDesignSessionArtifacts(edited.session, dimensionArtifacts);
  const initialMass = validateMass(resultFor(initialRun.value, "mass-properties").payload, INITIAL_WIDTH_M);
  const dimensionMass = validateMass(resultFor(dimensionRun.value, "mass-properties").payload, EDITED_WIDTH_M);
  const stepOutput = resultFor(dimensionRun.value, "step");
  const stepRun = await timed(async () => ExactStepImportResultSchema.parseAsync(
    await adapter.importStep(await ExactStepImportRequestSchema.parseAsync({
      requestId: "step-round-trip", sourceRevision: dimensionDocument.revision,
      step: { artifact: stepOutput.artifact, payload: stepOutput.payload },
      settings: { gate: "exact-cad-browser-v1" },
    }), signal),
  ));
  if (stepRun.value.requestId !== "step-round-trip"
    || stepRun.value.sourceRevision !== dimensionDocument.revision
    || stepRun.value.sourceArtifactId !== stepOutput.artifact.id
    || stepRun.value.solidCount !== 1 || stepRun.value.invalidSolidCount !== 0) {
    throw new Error("Exact STEP import returned invalid ownership or solid evidence");
  }
  activeSession = attachDesignSessionArtifacts(activeSession, [stepRun.value.artifact]);
  const importedMass = validateMass(stepRun.value.massProperties, EDITED_WIDTH_M);
  const maximumMassRelativeError = Math.max(initialMass.massError, dimensionMass.massError, importedMass.massError);
  const maximumVolumeRelativeError = Math.max(initialMass.volumeError, dimensionMass.volumeError, importedMass.volumeError);
  if (maximumMassRelativeError > RELATIVE_TOLERANCE) throw new Error(`Exact CAD mass relative error ${maximumMassRelativeError} exceeds ${RELATIVE_TOLERANCE}`);
  if (maximumVolumeRelativeError > RELATIVE_TOLERANCE) throw new Error(`Exact CAD volume relative error ${maximumVolumeRelativeError} exceeds ${RELATIVE_TOLERANCE}`);
  const expectedEnvelopeMm = [100, 40, 20] as const;
  const importedEnvelopeMm = stepRun.value.envelopeM.maximum.map((maximum, axis) =>
    (maximum - stepRun.value.envelopeM.minimum[axis]!) * 1_000) as [number, number, number];
  const envelopeRelativeError = Math.max(...importedEnvelopeMm.map((value, axis) => relativeError(value, expectedEnvelopeMm[axis]!)));
  if (envelopeRelativeError > RELATIVE_TOLERANCE) throw new Error(`STEP envelope relative error ${envelopeRelativeError} exceeds ${RELATIVE_TOLERANCE}`);
  const cancelRun = await timed(async () => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const evaluation = collectEvaluation(
      adapter, dimensionDocument, "cancelled", controller.signal,
      dependencies.terminalQuiescenceMs ?? 25,
      () => controller.abort(),
    );
    try { return await evaluation; } finally { signal.removeEventListener("abort", abort); }
  });
  const cancelledIndex = cancelRun.value.findIndex(({ state }) => state === "cancelled");
  const lateSuccess = cancelRun.value.findIndex(({ state }, index) =>
    index > cancelledIndex && state === "succeeded") !== -1;
  if (lateSuccess) throw new Error("Exact CAD worker emitted success after cancellation");
  if (cancelledIndex === -1) throw new Error("Exact CAD cancellation did not terminate as cancelled");
  const cancellation = cancelRun.value[cancelledIndex]!;
  if (cancellation.state !== "cancelled" || cancellation.workerDisposition !== "quarantined") {
    throw new Error("Exact CAD cancelled worker was not quarantined");
  }
  const finalRun = await timed(async () => requireSuccess(await collectEvaluation(adapter, dimensionDocument, "final", signal)));
  await verifiedArtifacts(finalRun.value, dimensionDocument.revision);
  const hashes = {
    initialBrep: resultFor(initialRun.value, "brep").artifact.contentDigest,
    dimensionBrep: resultFor(dimensionRun.value, "brep").artifact.contentDigest,
    finalBrep: resultFor(finalRun.value, "brep").artifact.contentDigest,
    initialStep: resultFor(initialRun.value, "step").artifact.contentDigest,
    dimensionStep: resultFor(dimensionRun.value, "step").artifact.contentDigest,
  };
  if (hashes.initialBrep === hashes.dimensionBrep) throw new Error("Exact CAD dimension rebuild did not change geometry");
  if (hashes.dimensionBrep !== hashes.finalBrep) throw new Error("Exact CAD final rebuild was not deterministic");
  return {
    status: "passed",
    timingsMs: { authoring: authored.elapsedMs, initialRebuild: initialRun.elapsed, dimensionRebuild: dimensionRun.elapsed, stepRoundTrip: stepRun.elapsed, cancellation: cancelRun.elapsed, finalRebuild: finalRun.elapsed, total: now() - started },
    revisions: { initial: initialDocument.revision, dimension: dimensionDocument.revision }, hashes,
    measurements: { maximumMassRelativeError, maximumVolumeRelativeError, invalidSolidCount: 0 },
    stepRoundTrip: { expectedEnvelopeMm, importedEnvelopeMm, envelopeRelativeError },
    cancellation: {
      outcome: "cancelled", lateSuccess,
      workerDisposition: cancellation.workerDisposition,
    },
    artifacts: {
      invalidatedCount: edited.session.artifacts.invalidatedIds.length,
      staleCount: 0,
      activeCount: activeSession.artifacts.index.artifacts.length,
    },
    renderMesh: renderMesh(resultFor(finalRun.value, "semantic-mesh").payload),
  };
}
