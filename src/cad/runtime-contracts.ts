import { z } from "zod";

import { ActionReceiptSchema } from "../domain/receipts";
import { RevisionSchema } from "../domain/snapshots";
import { ArtifactRecordSchema } from "./artifact-contract";
import { DesignDocumentSchema } from "./document-schema";

const JsonValueSchema = ActionReceiptSchema.shape.validatedInputs;
const JobIdSchema = z.string().min(1);

export const CadOutputSchema = z.enum([
  "brep",
  "semantic-mesh",
  "mass-properties",
  "section-curves",
  "step",
]);

export const CadEvaluationRequestSchema = z
  .object({
    requestId: z.string().min(1),
    document: DesignDocumentSchema,
    sourceRevision: RevisionSchema,
    requestedOutputs: z.array(CadOutputSchema).min(1),
    settings: JsonValueSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceRevision !== value.document.revision) {
      context.addIssue({
        code: "custom",
        path: ["sourceRevision"],
        message: "Source revision must match the document revision",
      });
    }
  });

const CadFailureSchema = z.object({
  code: z.enum([
    "invalid-document",
    "feature-failed",
    "invalid-solid",
    "reference-requires-repair",
    "resource-limit",
    "internal-error",
  ]),
  message: z.string().min(1),
}).strict();

export const CadEvaluationEventSchema = z.discriminatedUnion("state", [
  z.object({ requestId: z.string().min(1), state: z.literal("progress"), progress: z.number().min(0).max(1) }).strict(),
  z.object({ requestId: z.string().min(1), state: z.literal("succeeded"), artifacts: z.array(ArtifactRecordSchema) }).strict(),
  z.object({ requestId: z.string().min(1), state: z.literal("failed"), error: CadFailureSchema }).strict(),
  z.object({ requestId: z.string().min(1), state: z.literal("cancelled") }).strict(),
]);

export const EngineeringJobKindSchema = z.enum([
  "cad-rebuild",
  "collision",
  "mechanism",
  "topology",
  "fea",
  "cfd",
  "thermal",
  "additive",
  "slicing",
  "export",
]);
export const EngineeringTruthLevelSchema = z.enum([
  "interactive-estimate",
  "calibrated-surrogate",
  "converged-numerical-solve",
  "experimentally-validated",
]);

export const EngineeringJobRequestSchema = z.object({
  jobId: JobIdSchema,
  kind: EngineeringJobKindSchema,
  sourceRevision: RevisionSchema,
  inputArtifacts: z.array(ArtifactRecordSchema),
  settings: JsonValueSchema,
}).strict();

const EngineeringJobEventBaseSchema = z.object({
  jobId: JobIdSchema,
  progress: z.number().min(0).max(1),
  artifacts: z.array(ArtifactRecordSchema),
});

export const EngineeringJobEventSchema = z.discriminatedUnion("state", [
  EngineeringJobEventBaseSchema.extend({ state: z.literal("queued") }).strict(),
  EngineeringJobEventBaseSchema.extend({ state: z.literal("running") }).strict(),
  EngineeringJobEventBaseSchema.extend({ state: z.literal("partial") }).strict(),
  EngineeringJobEventBaseSchema.extend({
    state: z.literal("verified"),
    truthLevel: EngineeringTruthLevelSchema,
  }).strict(),
  EngineeringJobEventBaseSchema.extend({ state: z.literal("failed") }).strict(),
  EngineeringJobEventBaseSchema.extend({ state: z.literal("cancelled") }).strict(),
]);

export type CadEvaluationRequest = z.infer<typeof CadEvaluationRequestSchema>;
export type CadEvaluationEvent = z.infer<typeof CadEvaluationEventSchema>;
export type EngineeringJobRequest = z.infer<typeof EngineeringJobRequestSchema>;
export type EngineeringJobEvent = z.infer<typeof EngineeringJobEventSchema>;

export interface CadKernelAdapter {
  evaluate(
    request: CadEvaluationRequest,
    signal: AbortSignal,
    emit: (event: CadEvaluationEvent) => void,
  ): Promise<void>;
}
