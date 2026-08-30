import { OcctKernel } from "occt-wasm";
import occtWasmUrl from "occt-wasm/dist/occt-wasm.wasm?url";

import type { CadEvaluationRequest } from "../runtime-contracts";
import { createOcctBridge, type OcctBridge } from "./occt-bridge";
import { CadRebuildError, rebuildDocument } from "./feature-rebuild";
import { buildCadEvaluationResults } from "./rebuild-results";
import {
  OcctWorkerEventSchema,
  OcctWorkerRequestSchema,
  type OcctWorkerEvent,
  type OcctWorkerFailureCode,
} from "./occt-worker-contract";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let bridge: Promise<OcctBridge> | undefined;
let evaluationQueue = Promise.resolve();
let activeRequestId: string | undefined;
let activeController: AbortController | undefined;
let cancellationRequested = false;

function transferableBuffers(value: unknown, buffers = new Set<ArrayBuffer>()): Set<ArrayBuffer> {
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
  else if (Array.isArray(value)) for (const item of value) transferableBuffers(item, buffers);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) transferableBuffers(item, buffers);
  }
  return buffers;
}

const post = async (event: OcctWorkerEvent) => {
  const validated = await OcctWorkerEventSchema.parseAsync(event);
  scope.postMessage(validated, [...transferableBuffers(validated)]);
};

const messageFor = (error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : "Unknown OCCT worker error";

const classifyFailure = (error: unknown): OcctWorkerFailureCode => {
  const message = messageFor(error);
  if (/out of memory|memory access out of bounds|allocation failed/i.test(message)) {
    return "memory-exhausted";
  }
  if (error instanceof CadRebuildError) return error.code;
  return "feature-failed";
};

const getBridge = () => {
  bridge ??= OcctKernel.init({ wasm: occtWasmUrl }).then(createOcctBridge);
  return bridge;
};

const evaluate = async (request: CadEvaluationRequest) => {
  const { requestId } = request;
  activeRequestId = requestId;
  activeController = new AbortController();
  cancellationRequested = false;
  try {
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
    if (cancellationRequested) {
      await post({ type: "cancelled", requestId });
      return;
    }
    try {
      const payload = await rebuildDocument(
        owner,
        request.document,
        request.requestedOutputs,
        activeController.signal,
      );
      if (cancellationRequested || activeController.signal.aborted) {
        await post({ type: "cancelled", requestId });
        return;
      }
      const results = await buildCadEvaluationResults(request, payload);
      if (cancellationRequested || activeController.signal.aborted) {
        await post({ type: "cancelled", requestId });
        return;
      }
      await post({ type: "progress", requestId, progress: 1 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (cancellationRequested || activeController.signal.aborted) {
        await post({ type: "cancelled", requestId });
        return;
      }
      await post({
        type: "succeeded",
        requestId,
        requestedOutputs: [...request.requestedOutputs],
        results,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        await post({ type: "cancelled", requestId });
        return;
      }
      await post({
        type: "failed",
        requestId,
        error: { code: classifyFailure(error), message: messageFor(error) },
      });
    }
  } finally {
    if (activeRequestId === requestId) {
      activeRequestId = undefined;
      activeController = undefined;
      cancellationRequested = false;
    }
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
    if (activeRequestId === parsed.data.requestId) {
      cancellationRequested = true;
      activeController?.abort();
    }
    return;
  }
  const request = parsed.data.request;
  evaluationQueue = evaluationQueue.then(() => evaluate(request));
});
