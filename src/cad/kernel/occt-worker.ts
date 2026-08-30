import { OcctKernel } from "occt-wasm";
import occtWasmUrl from "occt-wasm/dist/occt-wasm.wasm?url";

import type { CadEvaluationRequest } from "../runtime-contracts";
import { createOcctBridge, type OcctBridge } from "./occt-bridge";
import {
  OcctWorkerEventSchema,
  OcctWorkerRequestSchema,
  type OcctWorkerEvent,
  type OcctWorkerFailureCode,
} from "./occt-worker-contract";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
const cancelled = new Set<string>();
let bridge: Promise<OcctBridge> | undefined;
let evaluationQueue = Promise.resolve();

const post = async (event: OcctWorkerEvent) => {
  scope.postMessage(await OcctWorkerEventSchema.parseAsync(event));
};

const messageFor = (error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : "Unknown OCCT worker error";

const classifyFailure = (error: unknown): OcctWorkerFailureCode => {
  const message = messageFor(error);
  if (/out of memory|memory access out of bounds|allocation failed/i.test(message)) {
    return "memory-exhausted";
  }
  return "feature-failed";
};

const getBridge = () => {
  bridge ??= OcctKernel.init({ wasm: occtWasmUrl }).then(createOcctBridge);
  return bridge;
};

const evaluate = async (request: CadEvaluationRequest) => {
  const { requestId } = request;
  if (cancelled.delete(requestId)) {
    await post({ type: "cancelled", requestId });
    return;
  }
  await post({ type: "progress", requestId, progress: 0 });
  let owner: OcctBridge;
  try {
    owner = await getBridge();
  } catch (error) {
    const classified = classifyFailure(error);
    const code = classified === "memory-exhausted" ? classified : "initialization-failed";
    bridge = undefined;
    await post({ type: "failed", requestId, error: { code, message: messageFor(error) } });
    return;
  }
  try {
    if (cancelled.delete(requestId)) {
      await post({ type: "cancelled", requestId });
      return;
    }
    owner.withKernel(() => undefined);
    await post({
      type: "failed",
      requestId,
      error: {
        code: "feature-failed",
        message: "Exact OCCT feature evaluation is not implemented",
      },
    });
  } catch (error) {
    await post({
      type: "failed",
      requestId,
      error: { code: classifyFailure(error), message: messageFor(error) },
    });
  } finally {
    cancelled.delete(requestId);
  }
};

const requestIdFrom = (value: unknown) => {
  if (!value || typeof value !== "object") return "unknown-request";
  const candidate = value as { requestId?: unknown; request?: { requestId?: unknown } };
  const requestId = candidate.requestId ?? candidate.request?.requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : "unknown-request";
};

scope.addEventListener("message", ({ data }) => {
  const parsed = OcctWorkerRequestSchema.safeParse(data);
  if (!parsed.success) {
    void post({
      type: "failed",
      requestId: requestIdFrom(data),
      error: { code: "protocol-mismatch", message: "Invalid OCCT worker request" },
    });
    return;
  }
  if (parsed.data.type === "cancel") {
    cancelled.add(parsed.data.requestId);
    return;
  }
  const request = parsed.data.request;
  evaluationQueue = evaluationQueue.then(() => evaluate(request));
});
