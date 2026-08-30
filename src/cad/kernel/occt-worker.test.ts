import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDesignDocument } from "../document-schema";
import { CadEvaluationRequestSchema } from "../runtime-contracts";
import type { OcctWorkerRequest } from "./occt-worker-contract";

const occt = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("occt-wasm", () => ({ OcctKernel: { init: occt.init } }));
vi.mock("occt-wasm/dist/occt-wasm.wasm?url", () => ({ default: "/occt-wasm.wasm" }));

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

async function evaluation(requestId: string) {
  const document = await createDesignDocument({
    id: "part",
    label: "Part",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "agent", id: "test" },
  });
  return CadEvaluationRequestSchema.parse({
    requestId,
    document,
    sourceRevision: document.revision,
    requestedOutputs: ["mass-properties"],
    settings: {},
  });
}

describe("OCCT worker", () => {
  beforeEach(() => {
    vi.resetModules();
    occt.init.mockResolvedValue({ [Symbol.dispose]: () => undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not let a cancellation without an active owner poison a reused request ID", async () => {
    const scope = new ControlledWorkerScope();
    vi.stubGlobal("self", scope);
    await import("./occt-worker");
    const request = await evaluation("reused");

    scope.send({ type: "cancel", requestId: "reused" });
    scope.send({ type: "evaluate", request });

    await vi.waitFor(() => {
      expect(scope.messages).toContainEqual({
        type: "failed",
        requestId: "reused",
        error: {
          code: "feature-failed",
          message: "Exact OCCT feature evaluation is not implemented",
        },
      });
    });
    expect(scope.messages).not.toContainEqual({ type: "cancelled", requestId: "reused" });
  });
});
