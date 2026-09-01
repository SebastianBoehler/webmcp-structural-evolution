import { describe, expect, it, vi } from "vitest";

import { defineDesignDocument } from "../document-schema";
import { defineCadEvaluationRequest, type CadEvaluationEvent } from "../runtime-contracts";
import {
  createOcctWorkerClient, type OcctWorkerLike, type OcctWorkerMessageEvent,
} from "./occt-worker-client";

class ControlledWorker implements OcctWorkerLike {
  readonly posted: unknown[] = [];
  terminateCount = 0;
  private readonly listeners = new Set<(event: OcctWorkerMessageEvent) => void>();
  postMessage(message: unknown): void { this.posted.push(message); }
  addEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void {
    this.listeners.delete(listener);
  }
  terminate(): void { this.terminateCount += 1; }
  emit(data: unknown): void { for (const listener of this.listeners) listener({ data }); }
}

async function request(requestId: string) {
  const document = await defineDesignDocument({
    id: "body-client", label: "Body client", schemaVersion: 4,
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "agent", id: "test" },
    frames: [{
      id: "world", label: "World",
      transform: {
        position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
        orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
      },
    }],
    parameters: [],
    sketches: [{
      id: "sketch", plane: "frame:world",
      entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.01, 0.01] }],
      constraints: [
        { id: "width", kind: "distance", first: { entityId: "outline", point: "left" }, second: { entityId: "outline", point: "right" }, axis: "x", valueM: 0.01 },
        { id: "height", kind: "distance", first: { entityId: "outline", point: "bottom" }, second: { entityId: "outline", point: "top" }, axis: "y", valueM: 0.01 },
      ],
    }],
    features: [{ id: "feature", kind: "extrude", sketchId: "sketch", distanceM: 0.01 }],
    bodies: [{ id: "body", featureId: "feature" }],
    components: [], instances: [], mates: [], namedSelections: [], materials: [], studies: [],
  });
  return defineCadEvaluationRequest({
    requestId, document, sourceRevision: document.revision,
    requestedOutputs: ["body-dynamics"], settings: {},
  });
}

const entry = (bodyId = "body", bytes: Uint8Array = new Uint8Array([1])) => ({
  bodyId, brep: { bytes }, volumeM3: 1, centerOfMassM: [0, 0, 0],
  centroidalInertiaUnitDensityKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1],
});

async function runWith(payload: unknown) {
  const worker = new ControlledWorker();
  const events: CadEvaluationEvent[] = [];
  const activeRequest = await request("body-dynamics-client");
  const evaluation = createOcctWorkerClient(() => worker).evaluate(
    activeRequest, new AbortController().signal, (event) => events.push(event),
  );
  await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
  worker.emit({
    type: "succeeded", requestId: activeRequest.requestId,
    sourceRevision: activeRequest.sourceRevision,
    requestedOutputs: ["body-dynamics"],
    results: [{ output: "body-dynamics", payload }],
  });
  await evaluation;
  return { events, worker };
}

describe("OCCT per-body dynamics client boundary", () => {
  it("accepts exactly one same-request result with full body coverage", async () => {
    const { events } = await runWith({ bodies: [entry()] });
    expect(events).toEqual([expect.objectContaining({
      state: "succeeded", requestedOutputs: ["body-dynamics"],
    })]);
  });

  it.each([
    ["missing", { bodies: [] }],
    ["duplicate", { bodies: [entry(), entry()] }],
    ["wrong", { bodies: [entry("other-body")] }],
  ])("rejects %s per-body coverage without publishing partial success", async (_label, payload) => {
    const { events, worker } = await runWith(payload);
    expect(events).toEqual([expect.objectContaining({
      state: "failed", error: { code: "internal-error", message: expect.any(String) },
    })]);
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects an oversized per-body BREP before async success validation", async () => {
    const { events } = await runWith({
      bodies: [entry("body", new Uint8Array(128 * 1024 * 1024 + 1))],
    });
    expect(events).toEqual([expect.objectContaining({
      state: "failed", error: { code: "resource-limit", message: expect.stringMatching(/BREP bytes/i) },
    })]);
  });
});
