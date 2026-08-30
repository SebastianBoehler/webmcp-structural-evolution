import type {
  CadEvaluationEvent, CadEvaluationRequest, ExactStepImportRequest, ExactStepImportResult,
} from "../runtime-contracts";

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

interface PendingBase {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly resolve: () => void;
}

interface PendingEvaluation extends PendingBase {
  readonly kind: "evaluation";
  readonly request: CadEvaluationRequest;
  readonly emit: (event: CadEvaluationEvent) => void;
}

interface PendingStepImport extends PendingBase {
  readonly kind: "step-import";
  readonly request: ExactStepImportRequest;
  readonly resolveResult: (result: ExactStepImportResult) => void;
  readonly reject: (error: Error) => void;
}

export type PendingOcctOperation = PendingEvaluation | PendingStepImport;
