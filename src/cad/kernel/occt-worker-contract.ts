import { z } from "zod";

import {
  CadEvaluationEventSchema,
  CadEvaluationRequestSchema,
  type CadEvaluationEvent,
  type CadEvaluationRequest,
} from "../runtime-contracts";

const RequestIdSchema = z.string().min(1);

export type OcctWorkerRequest =
  | { readonly type: "evaluate"; readonly request: CadEvaluationRequest }
  | { readonly type: "cancel"; readonly requestId: string };

export const OcctWorkerRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("evaluate"),
    request: CadEvaluationRequestSchema,
  }).strict(),
  z.object({
    type: z.literal("cancel"),
    requestId: RequestIdSchema,
  }).strict(),
]);

export const OcctWorkerFailureCodeSchema = z.enum([
  "initialization-failed",
  "memory-exhausted",
  "feature-failed",
  "invalid-solid",
  "protocol-mismatch",
  "device-error",
]);

const OcctWorkerFailureSchema = z.object({
  code: OcctWorkerFailureCodeSchema,
  message: z.string().min(1),
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

export const OcctWorkerEventSchema = z.discriminatedUnion("type", [
  ProgressSchema,
  SucceededSchema,
  FailedSchema,
  CancelledSchema,
]);

type CadSuccess = Extract<CadEvaluationEvent, { state: "succeeded" }>;

export type OcctWorkerFailureCode = z.infer<typeof OcctWorkerFailureCodeSchema>;
export type OcctWorkerEvent =
  | Readonly<z.infer<typeof ProgressSchema>>
  | Readonly<{ readonly type: "succeeded" } & Omit<CadSuccess, "state">>
  | Readonly<z.infer<typeof FailedSchema>>
  | Readonly<z.infer<typeof CancelledSchema>>;
