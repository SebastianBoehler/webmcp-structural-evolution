import { afterEach, describe, expect, it, vi } from "vitest";

import { defineArtifactRecord } from "../artifact-contract";
import { CAD_RESOURCE_LIMITS } from "../cad-resource-limits";
import { createDesignDocument } from "../document-schema";
import { digestCadOutputPayload } from "../rebuild-payload";
import { CadEvaluationRequestSchema, type CadEvaluationEvent } from "../runtime-contracts";
import {
  createOcctWorkerClient,
  type OcctWorkerLike,
  type OcctWorkerMessageEvent,
} from "./occt-worker-client";

class ControlledWorker implements OcctWorkerLike {
  readonly posted: unknown[] = [];
  private readonly listeners = new Set<(event: OcctWorkerMessageEvent) => void>();
  postMessage(message: unknown) { this.posted.push(message); }
  addEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void) {
    this.listeners.delete(listener);
  }
  terminate() { this.listeners.clear(); }
  emit(data: unknown) { for (const listener of this.listeners) listener({ data }); }
}

const semantic = () => ({
  positionsM: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(),
  faces: [], triangleFaceIndices: new Uint32Array(), edgePointsM: new Float32Array(),
  edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
});

async function mechanismRequest(requestId: string) {
  const document = await createDesignDocument({
    id: "mechanism-ingress", label: "Mechanism ingress",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "agent", id: "test" },
  });
  return CadEvaluationRequestSchema.parse({
    requestId, document, sourceRevision: document.revision,
    requestedOutputs: ["brep", "semantic-mesh", "body-dynamics"],
    settings: { consumer: "mechanism-exact-source-v1" },
  });
}

async function artifact(kind: "brep" | "render-mesh" | "export", payload: unknown, revision: string) {
  return defineArtifactRecord({
    kind, sourceRevision: revision,
    producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: "a".repeat(64),
    contentDigest: await digestCadOutputPayload(payload), units: "m",
    mediaType: kind === "render-mesh" ? "application/vnd.webmcp.semantic-mesh" : "application/octet-stream",
    dependencies: [],
  });
}

async function rawSuccess(request: Awaited<ReturnType<typeof mechanismRequest>>) {
  const brep = { bytes: new Uint8Array([1]) };
  const mesh = semantic();
  return {
    type: "succeeded", requestId: request.requestId, sourceRevision: request.sourceRevision,
    requestedOutputs: [...request.requestedOutputs],
    results: [
      { output: "brep", artifact: await artifact("brep", brep, request.sourceRevision), payload: brep },
      { output: "semantic-mesh", artifact: await artifact("render-mesh", mesh, request.sourceRevision), payload: mesh },
      { output: "body-dynamics", payload: { bodies: [{
        bodyId: "body", brep: { bytes: new Uint8Array([2]) }, volumeM3: 1,
        centerOfMassM: [0, 0, 0],
        centroidalInertiaUnitDensityKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      }] } },
    ],
  };
}

function countArtifactDigests() {
  const original = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let calls = 0;
  vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, data) => {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    if (bytes.byteLength < 64 * 1024
      && new TextDecoder().decode(bytes).includes("occt-wasm")) calls += 1;
    return original(algorithm, data);
  });
  return () => calls;
}

afterEach(() => vi.restoreAllMocks());

describe("mechanism exact OCCT client ingress", () => {
  it.each([
    ["unsafe aggregate", async (event: Awaited<ReturnType<typeof rawSuccess>>) => {
      event.results[0]!.payload = {
        bytes: new Uint8Array(new SharedArrayBuffer(1)) as unknown as Uint8Array<ArrayBuffer>,
      };
    }],
    ["over-budget combined", async (event: Awaited<ReturnType<typeof rawSuccess>>) => {
      event.results[2]!.payload = { bodies: [{
        bodyId: "body",
        brep: { bytes: new Uint8Array(CAD_RESOURCE_LIMITS.mechanismExactSourceBytes + 1) },
        volumeM3: 1, centerOfMassM: [0, 0, 0],
        centroidalInertiaUnitDensityKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      }] };
    }],
    ["unexpected oversized artifact", async (
      event: Awaited<ReturnType<typeof rawSuccess>>, revision: string,
    ) => {
      const payload = { bytes: new Uint8Array(CAD_RESOURCE_LIMITS.mechanismExactSourceBytes + 1) };
      event.results.push({
        output: "step", artifact: await artifact("export", payload, revision), payload,
      });
    }],
  ])("rejects %s before asynchronous terminal digests", async (_label, mutate) => {
    const request = await mechanismRequest(`preflight-${_label}`);
    const event = await rawSuccess(request);
    await mutate(event, request.sourceRevision);
    const digestCalls = countArtifactDigests();
    const worker = new ControlledWorker();
    const events: CadEvaluationEvent[] = [];
    const pending = createOcctWorkerClient(() => worker).evaluate(
      request, new AbortController().signal, (value) => events.push(value),
    );
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    worker.emit(event);
    await pending;

    expect(digestCalls()).toBe(0);
    expect(events.at(-1)?.state).toBe("failed");
  });
});
