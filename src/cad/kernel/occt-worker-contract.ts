import { z } from "zod";

import { RevisionSchema } from "../../domain/snapshots";
import { SemanticReferenceSchema } from "../document-schema";
import {
  CadEvaluationEventSchema,
  CadEvaluationRequestSchema,
  ExactStepImportRequestSchema,
  ExactStepImportResultSchema,
  type CadEvaluationEvent,
  type CadEvaluationRequest,
  type ExactStepImportResult,
} from "../runtime-contracts";

const RequestIdSchema = z.string().min(1);

export type OcctWorkerRequest =
  | { readonly type: "evaluate"; readonly request: CadEvaluationRequest }
  | { readonly type: "import-step"; readonly request: z.infer<typeof ExactStepImportRequestSchema> }
  | { readonly type: "cancel"; readonly requestId: string };

export const OcctWorkerRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("evaluate"),
    request: CadEvaluationRequestSchema,
  }).strict(),
  z.object({
    type: z.literal("import-step"),
    request: ExactStepImportRequestSchema,
  }).strict(),
  z.object({
    type: z.literal("cancel"),
    requestId: RequestIdSchema,
  }).strict(),
]);

export const OcctWorkerFailureCodeSchema = z.enum([
  "invalid-document",
  "initialization-failed",
  "memory-exhausted",
  "feature-failed",
  "invalid-solid",
  "reference-requires-repair",
  "resource-limit",
  "sketch-constraint-unsatisfied",
  "sketch-under-constrained",
  "sketch-over-constrained",
  "protocol-mismatch",
  "device-error",
]);

const OcctWorkerFailureSchema = z.object({
  code: OcctWorkerFailureCodeSchema,
  message: z.string().min(1),
  affectedConsumers: z.array(SemanticReferenceSchema).optional(),
}).strict();

const ProgressSchema = z.object({
  type: z.literal("progress"),
  requestId: RequestIdSchema,
  progress: z.number().min(0).max(1),
}).strict();

const CancelledSchema = z.object({
  type: z.literal("cancelled"),
  requestId: RequestIdSchema,
}).strict();

const FailedSchema = z.object({
  type: z.literal("failed"),
  requestId: RequestIdSchema,
  error: OcctWorkerFailureSchema,
}).strict();

const SucceededSchema = z.object({
  type: z.literal("succeeded"),
  requestId: RequestIdSchema,
  sourceRevision: RevisionSchema,
  requestedOutputs: z.array(z.string()).min(1),
  results: z.array(z.unknown()).min(1),
}).strict().superRefine(async (value, context) => {
  const { type: state, ...payload } = value;
  const parsed = await CadEvaluationEventSchema.safeParseAsync({ ...payload, state });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  }
});

const StepImportSucceededSchema = z.object({
  type: z.literal("step-import-succeeded"),
  requestId: RequestIdSchema,
  result: z.unknown(),
}).strict().superRefine(async (value, context) => {
  const parsed = await ExactStepImportResultSchema.safeParseAsync(value.result);
  if (!parsed.success || parsed.data.requestId !== value.requestId) {
    context.addIssue({ code: "custom", path: ["result"], message: "Invalid exact STEP import result" });
  }
});

export const OcctWorkerEventSchema = z.discriminatedUnion("type", [
  ProgressSchema,
  SucceededSchema,
  StepImportSucceededSchema,
  FailedSchema,
  CancelledSchema,
]);

type CadSuccess = Extract<CadEvaluationEvent, { state: "succeeded" }>;

export type OcctWorkerFailureCode = z.infer<typeof OcctWorkerFailureCodeSchema>;
export type OcctWorkerEvent =
  | Readonly<z.infer<typeof ProgressSchema>>
  | Readonly<{ readonly type: "succeeded" } & Omit<CadSuccess, "state">>
  | Readonly<{ readonly type: "step-import-succeeded"; readonly requestId: string; readonly result: ExactStepImportResult }>
  | Readonly<z.infer<typeof FailedSchema>>
  | Readonly<z.infer<typeof CancelledSchema>>;
