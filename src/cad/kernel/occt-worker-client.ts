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
    case "reference-requires-repair": return "reference-requires-repair" as const;
    default: return "internal-error" as const;
  }
};

const isFatal = (code: OcctWorkerFailureCode) =>
  code === "protocol-mismatch" || code === "device-error";

export function createOcctWorkerClient(factory: OcctWorkerFactory) {
  let worker: OcctWorkerLike | undefined;
  let active: PendingEvaluation | undefined;
  let settling: PendingEvaluation | undefined;
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
    if (settling === completed) settling = undefined;
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
    if (settling === active) return;
    if (event.type === "succeeded") return;
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

  const requestedOutputsMatch = (
    request: CadEvaluationRequest,
    event: Extract<OcctWorkerEvent, { type: "succeeded" }>,
  ) => request.requestedOutputs.length === event.requestedOutputs.length
    && request.requestedOutputs.every((output, index) => event.requestedOutputs[index] === output);

  async function acceptSuccess(
    owner: PendingEvaluation,
    event: Extract<OcctWorkerEvent, { type: "succeeded" }>,
  ) {
    if (active !== owner || settling !== owner) return;
    if (event.requestId !== owner.request.requestId) {
      protocolFailure("OCCT worker response did not match the active request");
      return;
    }
    if (!requestedOutputsMatch(owner.request, event)) {
      protocolFailure("OCCT worker success outputs did not match the active request");
      return;
    }
    if (owner.signal.aborted) {
      emit({ requestId: event.requestId, state: "cancelled" });
      finish();
      return;
    }
    try {
      const { type: _type, ...success } = event;
      const validated = await CadEvaluationEventSchema.parseAsync({ ...success, state: "succeeded" });
      if (active !== owner || settling !== owner) return;
      owner.emit(validated);
      finish();
    } catch {
      if (active === owner && settling === owner) {
        protocolFailure("OCCT worker returned an invalid success event");
      }
    }
  }

  const beginSuccessValidation = (data: object) => {
    const owner = active;
    if (!owner) {
      protocolFailure("OCCT worker returned a success without an active request");
      return;
    }
    const requestId = "requestId" in data ? data.requestId : undefined;
    if (typeof requestId === "string" && requestId !== owner.request.requestId) {
      protocolFailure("OCCT worker response did not match the active request");
      return;
    }
    if (settling === owner) {
      void OcctWorkerEventSchema.safeParseAsync(data).catch(() => undefined);
      return;
    }
    settling = owner;
    void OcctWorkerEventSchema.safeParseAsync(data).then((parsed) => {
      if (active !== owner || settling !== owner) return;
      if (!parsed.success || parsed.data.type !== "succeeded") {
        protocolFailure("OCCT worker returned an invalid protocol message");
        return;
      }
      void acceptSuccess(
        owner,
        parsed.data as Extract<OcctWorkerEvent, { type: "succeeded" }>,
      );
    }).catch(() => {
      if (active === owner && settling === owner) {
        protocolFailure("OCCT worker success validation failed");
      }
    });
  };

  const onMessage = (message: OcctWorkerMessageEvent) => {
    if (message.data && typeof message.data === "object"
      && "type" in message.data && message.data.type === "succeeded") {
      beginSuccessValidation(message.data);
      return;
    }
    if (settling && message.data && typeof message.data === "object"
      && "requestId" in message.data
      && message.data.requestId === settling.request.requestId) {
      OcctWorkerEventSchema.safeParse(message.data);
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
