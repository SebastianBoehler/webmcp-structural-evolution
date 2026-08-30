import {
  CadEvaluationEventSchema,
  CadEvaluationRequestSchema,
  type CadEvaluationEvent,
  type CadEvaluationRequest,
} from "../runtime-contracts";
import {
  OcctWorkerEventSchema,
  OcctWorkerRequestSchema,
  type OcctWorkerEvent,
  type OcctWorkerFailureCode,
} from "./occt-worker-contract";

export interface OcctWorkerMessageEvent {
  readonly data: unknown;
}

export interface OcctWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: OcctWorkerMessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: OcctWorkerMessageEvent) => void): void;
  terminate(): void;
}

export type OcctWorkerFactory = () => OcctWorkerLike;

interface PendingEvaluation {
  readonly request: CadEvaluationRequest;
  readonly signal: AbortSignal;
  readonly emit: (event: CadEvaluationEvent) => void;
  readonly resolve: () => void;
}

const failureCode = (code: OcctWorkerFailureCode) => {
  switch (code) {
    case "memory-exhausted": return "resource-limit" as const;
    case "feature-failed": return "feature-failed" as const;
    case "invalid-solid": return "invalid-solid" as const;
    default: return "internal-error" as const;
  }
};

const isFatal = (code: OcctWorkerFailureCode) =>
  code === "protocol-mismatch" || code === "device-error";

export function createOcctWorkerClient(factory: OcctWorkerFactory) {
  let worker: OcctWorkerLike | undefined;
  let active: PendingEvaluation | undefined;
  const queue: PendingEvaluation[] = [];

  const emit = (event: CadEvaluationEvent) => {
    active?.emit(CadEvaluationEventSchema.parse(event));
  };

  const replaceWorker = () => {
    if (!worker) return;
    worker.removeEventListener("message", onMessage);
    worker.terminate();
    worker = undefined;
  };

  const finish = () => {
    const completed = active;
    if (!completed) return;
    completed.signal.removeEventListener("abort", onAbort);
    active = undefined;
    completed.resolve();
    startNext();
  };

  const protocolFailure = (message: string) => {
    if (active) emit({
      requestId: active.request.requestId,
      state: "failed",
      error: { code: "internal-error", message },
    });
    replaceWorker();
    finish();
  };

  const acceptEvent = (event: OcctWorkerEvent) => {
    if (!active || event.requestId !== active.request.requestId) {
      protocolFailure("OCCT worker response did not match the active request");
      return;
    }
    if (event.type === "succeeded") {
      void acceptSuccess(event);
      return;
    }
    if (active.signal.aborted && event.type !== "progress"
      && !(event.type === "failed" && isFatal(event.error.code))) {
      emit({ requestId: event.requestId, state: "cancelled" });
      finish();
      return;
    }
    if (event.type === "progress") {
      if (active.signal.aborted) return;
      emit({ requestId: event.requestId, state: "progress", progress: event.progress });
      return;
    }
    if (event.type === "cancelled") {
      emit({ requestId: event.requestId, state: "cancelled" });
    } else {
      emit({
        requestId: event.requestId,
        state: "failed",
        error: { code: failureCode(event.error.code), message: event.error.message },
      });
      if (isFatal(event.error.code)) replaceWorker();
    }
    finish();
  };

  async function acceptSuccess(event: Extract<OcctWorkerEvent, { type: "succeeded" }>) {
    if (!active || active.request.requestId !== event.requestId) {
      protocolFailure("OCCT worker response did not match the active request");
      return;
    }
    if (active.signal.aborted) {
      emit({ requestId: event.requestId, state: "cancelled" });
      finish();
      return;
    }
    try {
      const { type: _type, ...success } = event;
      active.emit(await CadEvaluationEventSchema.parseAsync({ ...success, state: "succeeded" }));
      finish();
    } catch {
      protocolFailure("OCCT worker returned an invalid success event");
    }
  }

  const onMessage = (message: OcctWorkerMessageEvent) => {
    if (message.data && typeof message.data === "object"
      && "type" in message.data && message.data.type === "succeeded") {
      void OcctWorkerEventSchema.safeParseAsync(message.data).then((parsed) => {
        if (!parsed.success) {
          protocolFailure("OCCT worker returned an invalid protocol message");
          return;
        }
        acceptEvent(parsed.data as OcctWorkerEvent);
      }).catch(() => protocolFailure("OCCT worker success validation failed"));
      return;
    }
    const parsed = OcctWorkerEventSchema.safeParse(message.data);
    if (!parsed.success) {
      protocolFailure("OCCT worker returned an invalid protocol message");
      return;
    }
    acceptEvent(parsed.data as OcctWorkerEvent);
  };

  const getWorker = () => {
    if (worker) return worker;
    worker = factory();
    worker.addEventListener("message", onMessage);
    return worker;
  };

  function onAbort() {
    if (!active) return;
    const request = OcctWorkerRequestSchema.parse({
      type: "cancel",
      requestId: active.request.requestId,
    });
    getWorker().postMessage(request);
  }

  function startNext() {
    if (active || queue.length === 0) return;
    active = queue.shift();
    if (!active) return;
    if (active.signal.aborted) {
      emit({ requestId: active.request.requestId, state: "cancelled" });
      finish();
      return;
    }
    active.signal.addEventListener("abort", onAbort, { once: true });
    try {
      getWorker().postMessage(OcctWorkerRequestSchema.parse({ type: "evaluate", request: active.request }));
    } catch (error) {
      protocolFailure(error instanceof Error ? error.message : "OCCT worker device failure");
    }
  }

  return {
    evaluate(
      request: CadEvaluationRequest,
      signal: AbortSignal,
      eventEmitter: (event: CadEvaluationEvent) => void,
    ): Promise<void> {
      const validated = CadEvaluationRequestSchema.parse(request);
      return new Promise((resolve) => {
        queue.push({ request: validated, signal, emit: eventEmitter, resolve });
        startNext();
      });
    },
  };
}
