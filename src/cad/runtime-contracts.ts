import { z } from "zod";

import { ActionReceiptSchema } from "../domain/receipts";
import { RevisionSchema } from "../domain/snapshots";
import { ArtifactRecordSchema, type ArtifactKind } from "./artifact-contract";
import { defineDesignDocument, DesignDocumentSchema } from "./document-schema";
import {
  digestCadOutputPayload,
  MassPropertiesPayloadSchema,
  OpaqueBytesPayloadSchema,
  SectionCurvesPayloadSchema,
  SemanticMeshPayloadSchema,
} from "./rebuild-payload";

const JsonValueSchema = ActionReceiptSchema.shape.validatedInputs;
const JobIdSchema = z.string().min(1);

export const CadOutputSchema = z.enum([
  "brep",
  "semantic-mesh",
  "mass-properties",
  "section-curves",
  "step",
]);
const CadOutputsSchema = z.array(CadOutputSchema).min(1);
const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const CadEvaluationRequestSchema = z
  .object({
    requestId: z.string().min(1),
    document: DesignDocumentSchema,
    sourceRevision: RevisionSchema,
    requestedOutputs: CadOutputsSchema,
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

export async function defineCadEvaluationRequest(value: unknown): Promise<CadEvaluationRequest> {
  const request = CadEvaluationRequestSchema.parse(value);
  const document = await defineDesignDocument(request.document);
  return CadEvaluationRequestSchema.parse({ ...request, document });
}

export const ExactStepImportRequestSchema = z.object({
  requestId: z.string().min(1),
  sourceRevision: RevisionSchema,
  step: z.object({
    artifact: ArtifactRecordSchema.refine(({ kind }) => kind === "export", {
      message: "Exact STEP import requires an export artifact",
    }),
    payload: OpaqueBytesPayloadSchema,
  }).strict(),
  settings: JsonValueSchema,
}).strict().superRefine(async (value, context) => {
  if (value.step.artifact.sourceRevision !== value.sourceRevision) {
    context.addIssue({ code: "custom", path: ["step", "artifact", "sourceRevision"], message: "STEP artifact revision does not match import revision" });
  }
  if (await digestCadOutputPayload(value.step.payload) !== value.step.artifact.contentDigest) {
    context.addIssue({ code: "custom", path: ["step", "artifact", "contentDigest"], message: "STEP payload does not match its content digest" });
  }
});

export const ExactStepImportResultSchema = z.object({
  requestId: z.string().min(1),
  sourceRevision: RevisionSchema,
  sourceArtifactId: RevisionSchema,
  artifact: ArtifactRecordSchema.refine(({ kind }) => kind === "brep", {
    message: "Exact STEP import requires a BREP artifact",
  }),
  payload: OpaqueBytesPayloadSchema,
  massProperties: MassPropertiesPayloadSchema,
  envelopeM: z.object({ minimum: Vec3Schema, maximum: Vec3Schema }).strict(),
  solidCount: z.literal(1),
  invalidSolidCount: z.literal(0),
}).strict().superRefine(async (value, context) => {
  if (value.artifact.sourceRevision !== value.sourceRevision) {
    context.addIssue({ code: "custom", path: ["artifact", "sourceRevision"], message: "Imported BREP revision does not match STEP revision" });
  }
  if (!value.artifact.dependencies.some((dependency) =>
    dependency.kind === "artifact" && dependency.artifactId === value.sourceArtifactId)) {
    context.addIssue({ code: "custom", path: ["artifact", "dependencies"], message: "Imported BREP must depend on its source STEP artifact" });
  }
  if (await digestCadOutputPayload(value.payload) !== value.artifact.contentDigest) {
    context.addIssue({ code: "custom", path: ["artifact", "contentDigest"], message: "Imported BREP payload does not match its content digest" });
  }
});

const CadFailureSchema = z.object({
  code: z.enum([
    "invalid-document",
    "feature-failed",
    "invalid-solid",
    "reference-requires-repair",
    "resource-limit",
    "sketch-constraint-unsatisfied",
    "sketch-under-constrained",
    "sketch-over-constrained",
    "internal-error",
  ]),
  message: z.string().min(1),
}).strict();
const artifactForOutput = (
  output: z.infer<typeof CadOutputSchema>,
  kind: ArtifactKind,
) => ArtifactRecordSchema.refine(
  (artifact) => artifact.kind === kind,
  { message: `${output} output requires an ${kind} artifact` },
);
const CadEvaluationResultSchema = z.discriminatedUnion("output", [
  z.object({
    output: z.literal("brep"),
    artifact: artifactForOutput("brep", "brep"),
    payload: OpaqueBytesPayloadSchema,
  }).strict(),
  z.object({
    output: z.literal("semantic-mesh"),
    artifact: artifactForOutput("semantic-mesh", "render-mesh"),
    payload: SemanticMeshPayloadSchema,
  }).strict(),
  z.object({
    output: z.literal("mass-properties"),
    payload: MassPropertiesPayloadSchema,
  }).strict(),
  z.object({
    output: z.literal("section-curves"),
    payload: SectionCurvesPayloadSchema,
  }).strict(),
  z.object({
    output: z.literal("step"),
    artifact: artifactForOutput("step", "export"),
    payload: OpaqueBytesPayloadSchema,
  }).strict(),
]);
const CadEvaluationSuccessSchema = z.object({
  requestId: z.string().min(1),
  state: z.literal("succeeded"),
  requestedOutputs: CadOutputsSchema,
  results: z.array(CadEvaluationResultSchema).min(1),
}).strict().superRefine(async (value, context) => {
  const returned = new Set(value.results.map((result) => result.output));
  for (const output of value.requestedOutputs) {
    if (!returned.has(output)) {
      context.addIssue({ code: "custom", path: ["results"], message: `Missing requested output: ${output}` });
    }
  }
  for (const [index, result] of value.results.entries()) {
    if (!value.requestedOutputs.includes(result.output)) {
      context.addIssue({ code: "custom", path: ["results", index, "output"], message: `Unexpected output: ${result.output}` });
    }
    if ("artifact" in result
      && await digestCadOutputPayload(result.payload) !== result.artifact.contentDigest) {
      context.addIssue({
        code: "custom",
        path: ["results", index, "artifact", "contentDigest"],
        message: `${result.output} payload does not match its content digest`,
      });
    }
  }
});

export const CadEvaluationEventSchema = z.discriminatedUnion("state", [
  z.object({ requestId: z.string().min(1), state: z.literal("progress"), progress: z.number().min(0).max(1) }).strict(),
  CadEvaluationSuccessSchema,
  z.object({ requestId: z.string().min(1), state: z.literal("failed"), error: CadFailureSchema }).strict(),
  z.object({
    requestId: z.string().min(1), state: z.literal("cancelled"),
    workerDisposition: z.enum(["quarantined", "not-started"]),
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
    progress: z.literal(1),
    artifacts: z.array(ArtifactRecordSchema).min(1),
  }).strict(),
  EngineeringJobEventBaseSchema.extend({ state: z.literal("failed") }).strict(),
  EngineeringJobEventBaseSchema.extend({ state: z.literal("cancelled") }).strict(),
]);

export type CadEvaluationRequest = z.infer<typeof CadEvaluationRequestSchema>;
export type CadEvaluationEvent = z.infer<typeof CadEvaluationEventSchema>;
export type CadOutput = z.infer<typeof CadOutputSchema>;
export type ExactStepImportRequest = z.infer<typeof ExactStepImportRequestSchema>;
export type ExactStepImportResult = z.infer<typeof ExactStepImportResultSchema>;
export type EngineeringJobRequest = z.infer<typeof EngineeringJobRequestSchema>;
export type EngineeringJobEvent = z.infer<typeof EngineeringJobEventSchema>;

export interface CadKernelAdapter {
  evaluate(
    request: CadEvaluationRequest,
    signal: AbortSignal,
    emit: (event: CadEvaluationEvent) => void,
  ): Promise<void>;
  importStep(request: ExactStepImportRequest, signal: AbortSignal): Promise<ExactStepImportResult>;
}
