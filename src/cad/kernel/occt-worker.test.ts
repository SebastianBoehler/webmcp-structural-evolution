import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineDesignDocument } from "../document-schema";
import { digestCadOutputPayload } from "../rebuild-payload";
import {
  CadEvaluationRequestSchema, ExactStepImportRequestSchema, type CadOutput,
} from "../runtime-contracts";
import type { OcctWorkerRequest } from "./occt-worker-contract";

const occtWasmPath = vi.hoisted(() => `${process.cwd()}/node_modules/occt-wasm/dist/occt-wasm.wasm`);
vi.mock("occt-wasm/dist/occt-wasm.wasm?url", () => ({ default: occtWasmPath }));

class ControlledWorkerScope {
  readonly messages: unknown[] = [];
  private listener: ((event: { readonly data: unknown }) => void) | undefined;

  addEventListener(_type: "message", listener: (event: { readonly data: unknown }) => void): void {
    this.listener = listener;
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  send(message: OcctWorkerRequest): void {
    this.listener?.({ data: message });
  }
}

async function evaluation(requestId: string, requestedOutputs: readonly CadOutput[] = ["mass-properties"]) {
  const document = await defineDesignDocument({
    id: "part", label: "Part", schemaVersion: 1,
    units: { length: "mm", angle: "deg", mass: "kg" }, createdBy: { kind: "agent", id: "test" },
    frames: [{
      id: "world", label: "World",
      transform: {
        position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
        orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
      },
    }],
    parameters: [{
      id: "plate-width", label: "Plate width",
      value: { kind: "length", value: { value: 0.08, unit: "m" } },
    }],
    sketches: [{
      id: "plate-sketch", plane: "frame:world",
      entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [{ parameterId: "plate-width" }, 0.04] }],
      constraints: [],
    }],
    features: [{ id: "plate", kind: "extrude", sketchId: "plate-sketch", distanceM: 0.01 }],
    bodies: [{ id: "plate-body", featureId: "plate" }],
    components: [], instances: [], mates: [], namedSelections: [],
  });
  return CadEvaluationRequestSchema.parse({
    requestId,
    document,
    sourceRevision: document.revision,
    requestedOutputs,
    settings: {},
  });
}

describe("OCCT worker", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not let a cancellation without an active owner poison a real exact rebuild", async () => {
    const scope = new ControlledWorkerScope();
    vi.stubGlobal("self", scope);
    await import("./occt-worker");
    const request = await evaluation("reused");

    scope.send({ type: "cancel", requestId: "reused" });
    scope.send({ type: "evaluate", request });

    await vi.waitFor(() => {
      expect(scope.messages).toContainEqual(expect.objectContaining({
        type: "succeeded",
        requestId: "reused",
        requestedOutputs: ["mass-properties"],
        results: [expect.objectContaining({
          output: "mass-properties",
          payload: expect.objectContaining({ volumeM3: expect.closeTo(0.000032, 12) }),
        })],
      }));
      expect(scope.messages).not.toContainEqual({
        type: "failed",
        requestId: "reused",
        error: expect.anything(),
      });
    });
    expect(scope.messages).not.toContainEqual({ type: "cancelled", requestId: "reused" });
  });

  it("publishes digest-bound transferable BREP, semantic mesh, and STEP artifacts", async () => {
    const scope = new ControlledWorkerScope();
    vi.stubGlobal("self", scope);
    await import("./occt-worker");
    const request = await evaluation("artifacts", ["brep", "semantic-mesh", "step"]);

    scope.send({ type: "evaluate", request });
    await vi.waitFor(() => {
      expect(scope.messages.some((message) =>
        !!message && typeof message === "object" && "type" in message && message.type === "succeeded"))
        .toBe(true);
    });
    const success = scope.messages.find((message) =>
      !!message && typeof message === "object" && "type" in message && message.type === "succeeded") as {
      results: Array<{
        output: string;
        artifact: { id: string; contentDigest: string; units: string; dependencies: unknown[] };
        payload: unknown;
      }>;
    };
    const brep = success.results.find(({ output }) => output === "brep")!;
    const semantic = success.results.find(({ output }) => output === "semantic-mesh")!;
    const step = success.results.find(({ output }) => output === "step")!;

    await expect(digestCadOutputPayload(brep.payload)).resolves.toBe(brep.artifact.contentDigest);
    await expect(digestCadOutputPayload(semantic.payload)).resolves.toBe(semantic.artifact.contentDigest);
    await expect(digestCadOutputPayload(step.payload)).resolves.toBe(step.artifact.contentDigest);
    expect(brep.artifact.units).toBe("m");
    expect(semantic.artifact.units).toBe("m");
    expect(step.artifact.units).toBe("mm");
    expect(brep.artifact.dependencies).toContainEqual({
      kind: "entity", reference: "parameter:plate-width",
    });
    expect(new TextDecoder().decode((step.payload as { bytes: Uint8Array }).bytes))
      .toContain("SI_UNIT(.MILLI.,.METRE.)");

    const importRequest = await ExactStepImportRequestSchema.parseAsync({
      requestId: "step-round-trip", sourceRevision: request.sourceRevision,
      step: { artifact: step.artifact, payload: step.payload }, settings: { gate: "worker-test" },
    });
    scope.send({ type: "import-step", request: importRequest });
    await vi.waitFor(() => {
      expect(scope.messages).toContainEqual(expect.objectContaining({
        type: "step-import-succeeded", requestId: "step-round-trip",
        result: expect.objectContaining({
          sourceArtifactId: step.artifact.id, solidCount: 1, invalidSolidCount: 0,
          envelopeM: {
            minimum: expect.any(Array), maximum: expect.any(Array),
          },
        }),
      }));
    });
    const imported = scope.messages.find((message) =>
      !!message && typeof message === "object" && "type" in message
      && message.type === "step-import-succeeded") as {
      result: { artifact: { contentDigest: string; dependencies: unknown[] }; payload: unknown };
    };
    await expect(digestCadOutputPayload(imported.result.payload))
      .resolves.toBe(imported.result.artifact.contentDigest);
    expect(imported.result.artifact.dependencies).toContainEqual({
      kind: "artifact", artifactId: step.artifact.id,
    });
  });
});
