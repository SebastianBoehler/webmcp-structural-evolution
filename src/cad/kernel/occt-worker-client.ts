import {
  CadEvaluationEventSchema,
  ExactStepImportRequestSchema,
  ExactStepImportResultSchema,
  type CadEvaluationEvent,
  type CadEvaluationRequest,
  type ExactStepImportRequest,
  type ExactStepImportResult,
} from "../runtime-contracts";
import { verifiedCadEvaluationRequest } from "./cad-request-ingress";
import {
  OcctWorkerEventSchema,
  OcctWorkerRequestSchema,
  type OcctWorkerEvent,
} from "./occt-worker-contract";
import type {
  OcctWorkerFactory, OcctWorkerLike, OcctWorkerMessageEvent, PendingOcctOperation,
} from "./occt-worker-client-types";
import { cadFailureCode, isFatalOcctFailure } from "./occt-worker-failure";
export type { OcctWorkerFactory, OcctWorkerLike, OcctWorkerMessageEvent } from "./occt-worker-client-types";
export function createOcctWorkerClient(factory: OcctWorkerFactory) {
  let worker: OcctWorkerLike | undefined;
  let active: PendingOcctOperation | undefined;
  let settling: PendingOcctOperation | undefined;
  let evaluationIngress = Promise.resolve();
  const queue: PendingOcctOperation[] = [];
  const emit = (event: CadEvaluationEvent) => {
    if (active?.kind === "evaluation") active.emit(CadEvaluationEventSchema.parse(event));
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
    void startNext();
  };
  const cancelOperation = (owner: PendingOcctOperation, workerDisposition: "quarantined" | "not-started") => {
    if (active !== owner) return;
    if (workerDisposition === "quarantined") replaceWorker();
    if (owner.kind === "evaluation") emit({
      requestId: owner.requestId, state: "cancelled", workerDisposition,
    });
    else owner.reject(new DOMException("Exact STEP import was cancelled", "AbortError"));
    finish();
  };
  const protocolFailure = (message: string) => {
    if (active?.kind === "evaluation") emit({
      requestId: active.requestId, state: "failed",
      error: { code: "internal-error", message },
    });
    else active?.reject(new Error(`Exact STEP import protocol failure: ${message}`));
    replaceWorker();
    finish();
  };
  const acceptEvent = (event: OcctWorkerEvent) => {
    if (!active || event.requestId !== active.requestId) {
      protocolFailure("OCCT worker response did not match the active request");
      return;
    }
    if (settling === active) return;
    if (event.type === "succeeded" || event.type === "step-import-succeeded") return;
    if (active.signal.aborted && event.type !== "progress"
      && !(event.type === "failed" && isFatalOcctFailure(event.error.code))) {
      cancelOperation(active, "quarantined");
      return;
    }
    if (event.type === "progress") {
      if (active.signal.aborted) return;
      emit({ requestId: event.requestId, state: "progress", progress: event.progress });
      return;
    }
    if (event.type === "cancelled") {
      cancelOperation(active, "quarantined");
      return;
    } else {
      if (active.kind === "evaluation") emit({
        requestId: event.requestId, state: "failed",
        error: {
          code: cadFailureCode(event.error.code), message: event.error.message,
          ...(event.error.affectedConsumers
            ? { affectedConsumers: event.error.affectedConsumers }
            : {}),
        },
      });
      else active.reject(new Error(`Exact STEP import failed (${event.error.code}): ${event.error.message}`));
      if (isFatalOcctFailure(event.error.code)) replaceWorker();
    }
    finish();
  };
  const requestedOutputsMatch = (
    request: CadEvaluationRequest,
    event: Extract<OcctWorkerEvent, { type: "succeeded" }>,
  ) => request.requestedOutputs.length === event.requestedOutputs.length
    && request.requestedOutputs.every((output, index) => event.requestedOutputs[index] === output);

  async function acceptSuccess(
    owner: PendingOcctOperation,
    event: Extract<OcctWorkerEvent, { type: "succeeded" }>,
  ) {
    if (active !== owner || settling !== owner) return;
    if (owner.kind !== "evaluation" || event.requestId !== owner.requestId) {
      protocolFailure("OCCT worker response did not match the active request");
      return;
    }
    if (!requestedOutputsMatch(owner.request, event)) {
      protocolFailure("OCCT worker success outputs did not match the active request");
      return;
    }
    if (event.sourceRevision !== owner.request.sourceRevision) {
      protocolFailure("OCCT worker success revision did not match the active request");
      return;
    }
    if (owner.signal.aborted) {
      cancelOperation(owner, "quarantined");
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
  async function acceptStepImportSuccess(
    owner: PendingOcctOperation,
    event: Extract<OcctWorkerEvent, { type: "step-import-succeeded" }>,
  ) {
    if (active !== owner || settling !== owner) return;
    if (owner.kind !== "step-import" || event.requestId !== owner.requestId) {
      protocolFailure("OCCT worker STEP import did not match the active request");
      return;
    }
    if (owner.signal.aborted) {
      cancelOperation(owner, "quarantined");
      return;
    }
    try {
      const result = await ExactStepImportResultSchema.parseAsync(event.result);
      if (active !== owner || settling !== owner) return;
      if (result.sourceRevision !== owner.request.sourceRevision
        || result.sourceArtifactId !== owner.request.step.artifact.id) {
        protocolFailure("OCCT worker STEP import ownership did not match the active request");
        return;
      }
      owner.resolveResult(result);
      finish();
    } catch {
      if (active === owner && settling === owner) {
        protocolFailure("OCCT worker returned an invalid STEP import result");
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
    if (typeof requestId === "string" && requestId !== owner.requestId) {
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
      if (!parsed.success || (parsed.data.type !== "succeeded"
        && parsed.data.type !== "step-import-succeeded")) {
        protocolFailure("OCCT worker returned an invalid protocol message");
        return;
      }
      if (parsed.data.type === "succeeded") void acceptSuccess(
        owner,
        parsed.data as Extract<OcctWorkerEvent, { type: "succeeded" }>,
      );
      else void acceptStepImportSuccess(owner, parsed.data as Extract<OcctWorkerEvent, { type: "step-import-succeeded" }>);
    }).catch(() => {
      if (active === owner && settling === owner) {
        protocolFailure("OCCT worker success validation failed");
      }
    });
  };
  const onMessage = (message: OcctWorkerMessageEvent) => {
    if (message.data && typeof message.data === "object"
      && "type" in message.data
      && (message.data.type === "succeeded" || message.data.type === "step-import-succeeded")) {
      beginSuccessValidation(message.data);
      return;
    }
    if (settling && message.data && typeof message.data === "object"
      && "requestId" in message.data
      && message.data.requestId === settling.requestId) {
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
    const owner = active;
    if (!owner) return;
    const request = OcctWorkerRequestSchema.parse({
      type: "cancel",
      requestId: owner.requestId,
    });
    try { getWorker().postMessage(request); } catch { /* quarantine below */ }
    finally { cancelOperation(owner, "quarantined"); }
  }

  async function startNext() {
    if (active || queue.length === 0) return;
    active = queue.shift();
    if (!active) return;
    if (active.signal.aborted) {
      cancelOperation(active, "not-started");
      return;
    }
    active.signal.addEventListener("abort", onAbort, { once: true });
    const owner = active;
    try {
      const message = {
        type: active.kind === "evaluation" ? "evaluate" : "import-step",
        request: active.request,
      };
      const validated = active.kind === "evaluation"
        ? OcctWorkerRequestSchema.parse(message)
        : await OcctWorkerRequestSchema.parseAsync(message);
      if (active !== owner) return;
      if (owner.signal.aborted) {
        cancelOperation(owner, "quarantined");
        return;
      }
      getWorker().postMessage(validated);
    } catch (error) {
      protocolFailure(error instanceof Error ? error.message : "OCCT worker device failure");
    }
  }

  return {
    async evaluate(
      request: CadEvaluationRequest,
      signal: AbortSignal,
      eventEmitter: (event: CadEvaluationEvent) => void,
    ): Promise<void> {
      const ingress = evaluationIngress.then(() =>
        verifiedCadEvaluationRequest(request, eventEmitter));
      evaluationIngress = ingress.then(() => undefined, () => undefined);
      const validated = await ingress;
      if (!validated) return;
      await new Promise<void>((resolve) => {
        queue.push({
          kind: "evaluation", requestId: validated.requestId,
          request: validated, signal, emit: eventEmitter, resolve,
        });
        void startNext();
      });
    },
    async importStep(
      request: ExactStepImportRequest,
      signal: AbortSignal,
    ): Promise<ExactStepImportResult> {
      const validated = await ExactStepImportRequestSchema.parseAsync(request);
      return new Promise((resolveResult, reject) => {
        queue.push({
          kind: "step-import", requestId: validated.requestId,
          request: validated, signal, resolve: () => undefined, resolveResult, reject,
        });
        void startNext();
      });
    },
  };
}
