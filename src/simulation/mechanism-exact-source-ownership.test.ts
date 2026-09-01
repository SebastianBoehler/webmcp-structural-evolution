import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CAD_RESOURCE_LIMITS } from "../cad/cad-resource-limits";
import { defineArtifactRecord } from "../cad/artifact-contract";
import { buildCadEvaluationResults } from "../cad/kernel/rebuild-results";
import { digestCadOutputPayload, type SemanticMeshPayload } from "../cad/rebuild-payload";
import {
  defineCadEvaluationRequest,
  type CadEvaluationEvent,
  type CadEvaluationRequest,
} from "../cad/runtime-contracts";
import { bodyDynamics, exactSourceDocument, semanticMesh } from "./mechanism-exact-source.test-support";

const worker = vi.hoisted(() => ({ evaluateMechanismExactRequest: vi.fn() }));
vi.mock("./mechanism-exact-worker", () => worker);

import { rebuildMechanismExactSource } from "./mechanism-exact-source";

type Emit = (event: CadEvaluationEvent) => void;

async function success(
  request: CadEvaluationRequest,
  brep: { bytes: Uint8Array },
  semantic: SemanticMeshPayload,
  dynamics = bodyDynamics(),
) {
  return {
    requestId: request.requestId, state: "succeeded" as const,
    sourceRevision: request.sourceRevision, requestedOutputs: [...request.requestedOutputs],
    results: await buildCadEvaluationResults(request, {
      featureIds: ["feature"], bodyIds: ["body"], brep,
      semanticMesh: semantic, bodyDynamics: dynamics as never,
    }),
  };
}

function populatedSemantic(
  positionsM: Float32Array,
  normals: Float32Array = new Float32Array(positionsM.length),
): SemanticMeshPayload {
  return {
    ...semanticMesh(), positionsM, normals,
  };
}

async function expectRejected(
  make: (request: CadEvaluationRequest) => Promise<CadEvaluationEvent>,
) {
  worker.evaluateMechanismExactRequest.mockImplementation(async (
    request: CadEvaluationRequest, _signal: AbortSignal, emit: Emit,
  ) => emit(await make(request)));
  await expect(rebuildMechanismExactSource(
    await exactSourceDocument(), new AbortController().signal,
  )).rejects.toThrow();
}

async function preparedSuccess(
  brep: { bytes: Uint8Array },
  semantic: SemanticMeshPayload,
  dynamics = bodyDynamics(),
) {
  const document = await exactSourceDocument();
  const request = await defineCadEvaluationRequest({
    requestId: "ownership-fixture", document, sourceRevision: document.revision,
    requestedOutputs: ["brep", "semantic-mesh", "body-dynamics"],
    settings: { consumer: "mechanism-exact-source-v1" },
  });
  return { document, event: await success(request, brep, semantic, dynamics) };
}

function countTerminalArtifactDigests() {
  const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let calls = 0;
  const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, data) => {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    if (bytes.byteLength < 64 * 1024
      && new TextDecoder().decode(bytes).includes("occt-wasm")) calls += 1;
    return originalDigest(algorithm, data);
  });
  return { calls: () => calls, spy };
}

async function rejectPreparedBeforeArtifactDigest(
  prepared: Awaited<ReturnType<typeof preparedSuccess>>,
) {
  worker.evaluateMechanismExactRequest.mockImplementation(async (
    request: CadEvaluationRequest, _signal: AbortSignal, emit: Emit,
  ) => emit({
    ...prepared.event, requestId: request.requestId,
    sourceRevision: request.sourceRevision, requestedOutputs: [...request.requestedOutputs],
  }));
  const digest = countTerminalArtifactDigests();
  try {
    await expect(rebuildMechanismExactSource(
      prepared.document, new AbortController().signal,
    )).rejects.toThrow();
    expect(digest.calls()).toBe(0);
  } finally {
    digest.spy.mockRestore();
  }
}

describe("mechanism exact-source payload ownership", () => {
  beforeEach(() => {
    worker.evaluateMechanismExactRequest.mockReset();
  });

  it.each([
    ["shared", () => new Uint8Array(new SharedArrayBuffer(4))],
    ["resizable", () => new Uint8Array(Reflect.construct(
      ArrayBuffer, [4, { maxByteLength: 8 }],
    ) as ArrayBuffer)],
    ["partial", () => new Uint8Array(new ArrayBuffer(8), 2, 4)],
  ])("rejects %s aggregate BREP backing", async (_label, bytes) => {
    await expectRejected(async (request) => success(request, { bytes: bytes() }, semanticMesh()));
  });

  it("rejects a detached aggregate BREP", async () => {
    await expectRejected(async (request) => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const event = await success(request, { bytes }, semanticMesh());
      structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
      return event as CadEvaluationEvent;
    });
  });

  it("preflights unsafe aggregate ownership before asynchronous artifact digests", async () => {
    await rejectPreparedBeforeArtifactDigest(await preparedSuccess(
      { bytes: new Uint8Array(new SharedArrayBuffer(4)) }, semanticMesh(),
    ));
  });

  it.each([
    ["shared", () => populatedSemantic(
      new Float32Array(new SharedArrayBuffer(12)),
      new Float32Array(new SharedArrayBuffer(12)),
    )],
    ["resizable", () => populatedSemantic(
      new Float32Array(Reflect.construct(ArrayBuffer, [12, { maxByteLength: 24 }]) as ArrayBuffer),
    )],
    ["partial", () => populatedSemantic(
      new Float32Array(new ArrayBuffer(16), 4, 3),
    )],
    ["alias", () => {
      const values = new Float32Array(3);
      return populatedSemantic(values, values);
    }],
  ])("rejects %s semantic typed backing", async (_label, makeSemantic) => {
    await expectRejected(async (request) => success(
      request, { bytes: new Uint8Array([1, 2, 3]) }, makeSemantic(),
    ));
  });

  it("rejects a detached semantic typed buffer", async () => {
    await expectRejected(async (request) => {
      const semantic = populatedSemantic(new Float32Array(3));
      const event = await success(request, { bytes: new Uint8Array([1]) }, semantic);
      structuredClone(semantic.positionsM.buffer, { transfer: [semantic.positionsM.buffer] });
      return event as CadEvaluationEvent;
    });
  });

  it("rejects aliasing between aggregate BREP and semantic geometry", async () => {
    await expectRejected(async (request) => {
      const buffer = new ArrayBuffer(12);
      return success(
        request, { bytes: new Uint8Array(buffer) },
        populatedSemantic(new Float32Array(buffer)),
      );
    });
  });

  it("accepts fixed owned cross-realm aggregate and semantic views", async () => {
    worker.evaluateMechanismExactRequest.mockImplementation(async (
      request: CadEvaluationRequest, _signal: AbortSignal, emit: Emit,
    ) => emit(await success(
      request,
      { bytes: runInNewContext("new Uint8Array([1, 2, 3])") as Uint8Array },
      populatedSemantic(runInNewContext("new Float32Array([0, 0, 0])") as Float32Array),
    )));
    const source = await rebuildMechanismExactSource(
      await exactSourceDocument(), new AbortController().signal,
    );
    expect(source).toMatchObject({ bodyDynamics: { bodies: [{ bodyId: "body" }] } });
    const visible = source.semanticMeshPayload;
    visible.positionsM[0] = 99;
    expect(source.semanticMeshPayload.positionsM[0]).toBe(0);
  });

  it("rejects combined exact payload residency above the browser-safe source cap", async () => {
    expect(CAD_RESOURCE_LIMITS.mechanismExactSourceBytes).toBe(96 * 1024 * 1024);
    await rejectPreparedBeforeArtifactDigest(await preparedSuccess(
      { bytes: new Uint8Array(40 * 1024 * 1024) },
      populatedSemantic(
        new Float32Array(3 * 1024 * 1024 / 4),
        new Float32Array(3 * 1024 * 1024 / 4),
      ),
      bodyDynamics({ brep: { bytes: new Uint8Array(51 * 1024 * 1024) } }),
    ));
  });

  it("rejects an unexpected oversized artifact before any terminal artifact digest", async () => {
    const prepared = await preparedSuccess(
      { bytes: new Uint8Array([1]) }, semanticMesh(),
    );
    const payload = { bytes: new Uint8Array(CAD_RESOURCE_LIMITS.mechanismExactSourceBytes + 1) };
    const artifact = await defineArtifactRecord({
      kind: "export", sourceRevision: prepared.document.revision,
      producer: { name: "occt-wasm", version: "4.3.2" },
      settingsDigest: "a".repeat(64), contentDigest: await digestCadOutputPayload(payload),
      units: "mm", mediaType: "model/step", dependencies: [],
    });
    prepared.event.results.push({ output: "step", artifact, payload });
    await rejectPreparedBeforeArtifactDigest(prepared);
  });
});
