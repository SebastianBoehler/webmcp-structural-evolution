import { z } from "zod";

import { ActionReceiptSchema } from "../domain/receipts";
import { RevisionSchema } from "../domain/snapshots";
import { ArtifactRecordSchema } from "./artifact-contract";
import { defineDesignDocument, DesignDocumentSchema, type DesignDocument } from "./document-schema";
import { EntityIdSchema } from "./model-schema";

const JsonValueSchema = ActionReceiptSchema.shape.validatedInputs;
const JobIdSchema = z.string().min(1);

export const EngineeringPartialResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("topology-objective-history"),
    samples: z.array(z.object({
      iteration: z.number().int().min(0),
      objectiveJ: z.number().finite().nonnegative(),
      maskDigest: RevisionSchema,
      structuralResultDigest: RevisionSchema,
    }).strict()).min(1).max(16),
  }).strict(),
  z.object({
    kind: z.literal("mechanism-worker-started"),
    requestId: z.string().min(1).max(256),
    mechanismInputDigest: RevisionSchema,
  }).strict(),
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
export const CapabilityLimitSchema = z.object({
  kind: z.enum(["dimension", "memory", "precision", "material"]),
  rule: z.string().min(1),
}).strict();
export const EngineeringJobErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("unsupported-capability"), message: z.string().min(1), limit: CapabilityLimitSchema }).strict(),
  z.object({ code: z.literal("invalid-input"), message: z.string().min(1) }).strict(),
  z.object({ code: z.literal("stale-revision"), message: z.string().min(1) }).strict(),
  z.object({ code: z.literal("resource-limit"), message: z.string().min(1) }).strict(),
  z.object({ code: z.literal("device-lost"), message: z.string().min(1) }).strict(),
  z.object({ code: z.literal("diverged"), message: z.string().min(1) }).strict(),
  z.object({ code: z.literal("internal-error"), message: z.string().min(1) }).strict(),
]);

export const EngineeringJobRequestSchema = z.object({
  jobId: JobIdSchema,
  kind: EngineeringJobKindSchema,
  sourceRevision: RevisionSchema,
  inputArtifacts: z.array(ArtifactRecordSchema),
  settings: JsonValueSchema,
}).strict();
export const EngineeringSolveRequestSchema = EngineeringJobRequestSchema.extend({
  studyId: EntityIdSchema,
  input: z.unknown(),
  document: DesignDocumentSchema,
}).strict().superRefine((value, context) => {
  if (value.sourceRevision !== value.document.revision) {
    context.addIssue({ code: "custom", path: ["sourceRevision"], message: "Source revision must match the source document" });
  }
  if (!value.document.studies.some(({ id }) => id === value.studyId)) {
    context.addIssue({ code: "custom", path: ["studyId"], message: `Study is unresolved: ${value.studyId}` });
  }
});

const EngineeringJobEventBaseSchema = z.object({
  jobId: JobIdSchema,
  progress: z.number().min(0).max(1),
  artifacts: z.array(ArtifactRecordSchema),
});
export const EngineeringJobEventSchema = z.discriminatedUnion("state", [
  EngineeringJobEventBaseSchema.extend({ state: z.literal("queued") }).strict(),
  EngineeringJobEventBaseSchema.extend({ state: z.literal("running") }).strict(),
  EngineeringJobEventBaseSchema.extend({
    state: z.literal("partial"),
    partial: EngineeringPartialResultSchema.optional(),
  }).strict(),
  EngineeringJobEventBaseSchema.extend({
    state: z.literal("verified"),
    truthLevel: EngineeringTruthLevelSchema,
    progress: z.literal(1),
    artifacts: z.array(ArtifactRecordSchema).min(1),
  }).strict(),
  EngineeringJobEventBaseSchema.extend({
    state: z.literal("failed"),
    error: EngineeringJobErrorSchema,
  }).strict(),
  EngineeringJobEventBaseSchema.extend({ state: z.literal("cancelled") }).strict(),
]);

type ParsedEngineeringSolveRequest = z.infer<typeof EngineeringSolveRequestSchema>;

export type EngineeringJobKind = z.infer<typeof EngineeringJobKindSchema>;
export type EngineeringTruthLevel = z.infer<typeof EngineeringTruthLevelSchema>;
export type CapabilityLimit = z.infer<typeof CapabilityLimitSchema>;
export type EngineeringJobError = z.infer<typeof EngineeringJobErrorSchema>;
export type EngineeringPartialResult = z.infer<typeof EngineeringPartialResultSchema>;
export type EngineeringJobRequest = z.infer<typeof EngineeringJobRequestSchema>;
export type EngineeringJobEvent = z.infer<typeof EngineeringJobEventSchema>;
export type EngineeringSolveRequest<Input> = Readonly<
  Omit<ParsedEngineeringSolveRequest, "input" | "document"> & {
    input: Input;
    document: DesignDocument;
  }
>;

export async function defineEngineeringSolveRequest<Input = unknown>(
  value: unknown,
): Promise<EngineeringSolveRequest<Input>> {
  const parsed = await EngineeringSolveRequestSchema.parseAsync(value);
  const document = await defineDesignDocument(parsed.document);
  return await EngineeringSolveRequestSchema.parseAsync({ ...parsed, document }) as EngineeringSolveRequest<Input>;
}
