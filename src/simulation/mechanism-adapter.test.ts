import { beforeEach, describe, expect, it, vi } from "vitest";

import { createArtifactIndex, defineArtifactRecord } from "../cad/artifact-contract";
import { invalidateArtifacts } from "../cad/artifact-invalidation";
import { defineEngineeringSolveRequest } from "../cad/engineering-job-contract";
import { applyDesignTransaction } from "../cad/transactions";
import { createArtifactStore, digestArtifactPayload } from "../engineering/artifact-store";
import { canonicalJson } from "../domain/canonical-json";
import type { EngineeringSolveRequest } from "../engineering/solver-adapter";
import type { MechanismInput } from "./mechanism-contract";
import { mechanismDocument } from "./compile-mechanism-study.test-support";

const seam = vi.hoisted(() => ({
  defineCompiledMechanismStudy: vi.fn(),
  defineMechanismInput: vi.fn(),
  solveMechanismStudy: vi.fn(),
}));
vi.mock("./compile-mechanism-study", () => ({
  defineCompiledMechanismStudy: seam.defineCompiledMechanismStudy,
}));
vi.mock("./mechanism-contract", async (importOriginal) => ({
  ...await importOriginal<typeof import("./mechanism-contract")>(),
  defineMechanismInput: seam.defineMechanismInput,
}));
vi.mock("./mechanism-solver", () => ({ solveMechanismStudy: seam.solveMechanismStudy }));

import { createMechanismAdapter, type MechanismAdapterInput } from "./mechanism-adapter";

async function request(
  kind: "mechanism" | "fea" = "mechanism",
  input: unknown = { schemaVersion: 1, mechanismInput: {} },
) {
  const base = await mechanismDocument();
  const added = await applyDesignTransaction(base, {
    id: "add-link-length", expectedRevision: base.revision,
    actor: { kind: "human", id: "mechanism-author" }, preconditions: [],
    commands: [{
      id: "define-link-length", type: "define-parameter",
      parameter: { id: "link-length", label: "Link length",
        value: { kind: "length", value: { value: 1, unit: "m" } } },
    }],
  });
  if (!added.ok) throw new Error("mechanism parameter fixture failed");
  const document = added.document;
  const dependencies = [
    { kind: "entity" as const, reference: `document:${document.id}` as const },
    ...document.features.map(({ id }) => ({ kind: "entity" as const, reference: `feature:${id}` as const })),
    ...document.bodies.map(({ id }) => ({ kind: "entity" as const, reference: `body:${id}` as const })),
  ];
  const roots = await Promise.all([
    defineArtifactRecord({ kind: "brep", sourceRevision: document.revision,
      producer: { name: "occt-wasm", version: "fixture" }, settingsDigest: "1".repeat(64),
      contentDigest: "2".repeat(64), units: "m", mediaType: "application/vnd.opencascade.brep",
      dependencies }),
    defineArtifactRecord({ kind: "render-mesh", sourceRevision: document.revision,
      producer: { name: "occt-wasm", version: "fixture" }, settingsDigest: "3".repeat(64),
      contentDigest: "4".repeat(64), units: "m",
      mediaType: "application/vnd.structural-evolution.semantic-mesh", dependencies }),
  ]);
  return defineEngineeringSolveRequest({
    jobId: "mechanism-job", kind, sourceRevision: document.revision,
    inputArtifacts: roots, settings: {}, studyId: "motion", document, input,
  }) as Promise<EngineeringSolveRequest<MechanismAdapterInput>>;
}

describe("mechanism solver adapter", () => {
  beforeEach(() => {
    seam.defineCompiledMechanismStudy.mockReset();
    seam.defineMechanismInput.mockReset();
    seam.solveMechanismStudy.mockReset();
  });

  it("compiles a cloneable document request and packs the verified replay bytes", async () => {
    const compiled = { exact: true };
    const replayContent = { encodingVersion: "mechanism-replay-v1", fixedStepHz: 240,
      frames: [{ stepIndex: 0 }], contacts: [], clearanceSamples: [] };
    const canonicalBytes = new TextEncoder().encode(canonicalJson(replayContent));
    const result = {
      truthLevel: "verified-mechanism-result", resultDigest: "a".repeat(64),
      sourceRevision: "c".repeat(64), studyId: "motion", mechanismInputDigest: "b".repeat(64),
      sourceArtifactIds: ["d".repeat(64)], replay: { canonicalBytes, replayDigest: "e".repeat(64) },
      evidence: { engineVersion: "0.18.1", runtimeVersion: "deterministic", settingsDigest: "f".repeat(64) },
    };
    const mechanismInput = { sourceRevision: "bound" } as unknown as MechanismInput;
    seam.defineMechanismInput.mockImplementation(async () => mechanismInput);
    seam.defineCompiledMechanismStudy.mockReturnValue(compiled);
    seam.solveMechanismStudy.mockImplementation(async (_compiled, _signal, onStarted) => {
      onStarted({ type: "started", requestId: "worker-request", mechanismInputDigest: "b".repeat(64) });
      return result;
    });
    const solveRequest = await request();
    seam.defineMechanismInput.mockResolvedValue({
      ...mechanismInput, sourceRevision: solveRequest.sourceRevision, studyId: solveRequest.studyId,
    });
    const signal = new AbortController().signal;
    const progress: unknown[] = [];

    const packed = await createMechanismAdapter().run(
      solveRequest, signal, (event) => progress.push(event),
    );

    expect(seam.defineMechanismInput).toHaveBeenCalledWith({});
    expect(seam.defineCompiledMechanismStudy).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRevision: solveRequest.sourceRevision, studyId: "motion" }),
      solveRequest.inputArtifacts,
    );
    expect(seam.solveMechanismStudy).toHaveBeenCalledWith(compiled, signal, expect.any(Function));
    expect(progress).toEqual([
      { progress: 0.1 },
      { progress: 0.55 },
      { progress: 0.6, partial: { kind: "mechanism-worker-started",
        requestId: "worker-request", mechanismInputDigest: "b".repeat(64) } },
      { progress: 0.9 },
    ]);
    expect(packed.output).toBe(result);
    expect(packed.truthLevel).toBe("converged-numerical-solve");
    expect(packed.artifacts).toHaveLength(1);
    expect(packed.artifacts[0].record).toMatchObject({
      kind: "mechanism-replay", sourceRevision: solveRequest.sourceRevision,
      mediaType: "application/vnd.structural-evolution.mechanism-replay-v1+json",
      units: "m",
    });
    expect(packed.artifacts[0].record.dependencies).toEqual(expect.arrayContaining([
      { kind: "entity", reference: "study:motion" },
      { kind: "entity", reference: "parameter:link-length" },
      { kind: "entity", reference: "feature:base-feature" },
      { kind: "entity", reference: "feature:link-feature" },
      { kind: "entity", reference: "body:base-body" },
      { kind: "entity", reference: "body:link-body" },
      { kind: "entity", reference: "instance:base" },
      { kind: "entity", reference: "instance:link" },
      { kind: "entity", reference: "mate:joint" },
      ...solveRequest.inputArtifacts.map(({ id }) => ({ kind: "artifact", artifactId: id })),
    ]));
    const payload = packed.artifacts[0].payload as unknown;
    expect(payload).toBeInstanceOf(Uint8Array);
    const bytes = payload as Uint8Array;
    const decoded = new TextDecoder().decode(bytes);
    const document = JSON.parse(decoded);
    expect(decoded).toBe(canonicalJson(document));
    expect(document).toMatchObject({
      schemaVersion: 1, kind: "mechanism-replay", replay: replayContent,
      lineage: { resultDigest: result.resultDigest, replayDigest: result.replay.replayDigest,
        sourceRevision: result.sourceRevision, studyId: result.studyId,
        mechanismInputDigest: result.mechanismInputDigest, sourceArtifactIds: result.sourceArtifactIds,
        evidence: result.evidence },
    });
    expect(new Uint8Array(bytes)).toEqual(bytes);
    expect(packed.artifacts[0].record.contentDigest).toBe(await digestArtifactPayload(bytes));
    const store = createArtifactStore();
    await store.put(packed.artifacts[0].record, bytes);
    const roundTrip = await store.get(packed.artifacts[0].record.id);
    expect(roundTrip).toBeInstanceOf(Uint8Array);
    expect(roundTrip).not.toBe(bytes);
    expect(roundTrip).toEqual(bytes);

    const changed = await applyDesignTransaction(solveRequest.document, {
      id: "change-link-length", expectedRevision: solveRequest.sourceRevision,
      actor: { kind: "human", id: "mechanism-author" }, preconditions: [],
      commands: [{ id: "set-link-length", type: "set-parameter", parameterId: "link-length",
        value: { kind: "length", value: { value: 2, unit: "m" } } }],
    });
    if (!changed.ok) throw new Error("mechanism parameter edit failed");
    const invalidated = invalidateArtifacts(
      createArtifactIndex(solveRequest.sourceRevision,
        [...solveRequest.inputArtifacts, packed.artifacts[0].record]),
      changed.changedReferences,
      changed.document.revision,
    );
    expect(invalidated.invalidatedIds).toContain(packed.artifacts[0].record.id);
  });

  it("rejects non-mechanism jobs and non-canonical adapter input at capability selection", async () => {
    const adapter = createMechanismAdapter();
    expect(adapter.supports(await request("fea"))).toMatchObject({ supported: false });
    expect(adapter.supports(await request("mechanism", {}))).toMatchObject({ supported: false });
  });

  it("does not start work after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createMechanismAdapter().run(await request(), controller.signal, vi.fn()))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(seam.defineMechanismInput).not.toHaveBeenCalled();
  });
});
