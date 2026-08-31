import type {
  CadEvaluationEvent,
  CadEvaluationRequest,
  ExactStepImportRequest,
  ExactStepImportResult,
} from "../runtime-contracts";
import { ExactStepImportRequestSchema } from "../runtime-contracts";
import { verifiedCadEvaluationRequest } from "./cad-request-ingress";
import type { PendingOcctOperation } from "./occt-worker-client-types";

type Enqueue = (operation: PendingOcctOperation) => void;

export function createOcctWorkerIngress(enqueue: Enqueue) {
  let tail = Promise.resolve();
  const reserve = (operation: () => Promise<void>) => {
    const slot = tail.then(operation);
    tail = slot.then(() => undefined, () => undefined);
    return slot;
  };

  return {
    evaluate(
      request: CadEvaluationRequest,
      signal: AbortSignal,
      emit: (event: CadEvaluationEvent) => void,
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        void reserve(async () => {
          const validated = await verifiedCadEvaluationRequest(request, emit);
          if (!validated) {
            resolve();
            return;
          }
          enqueue({
            kind: "evaluation", requestId: validated.requestId,
            request: validated, signal, emit, resolve,
          });
        }).catch(reject);
      });
    },

    importStep(
      request: ExactStepImportRequest,
      signal: AbortSignal,
    ): Promise<ExactStepImportResult> {
      return new Promise((resolveResult, reject) => {
        void reserve(async () => {
          const validated = await ExactStepImportRequestSchema.parseAsync(request);
          enqueue({
            kind: "step-import", requestId: validated.requestId,
            request: validated, signal, resolve: () => undefined, resolveResult, reject,
          });
        }).catch(reject);
      });
    },
  };
}
