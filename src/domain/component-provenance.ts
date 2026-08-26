import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO calendar date");
export const RedistributionStatusSchema = z.enum(["redistributable", "facts-only", "restricted", "unknown"]);
export const SourceClassificationSchema = z.enum([
  "manufacturer-datasheet", "manufacturer-product-page", "supplier-specification",
  "derived-constraint-input", "engineering-drawing", "user-observation",
]);

const SourceReferenceSchema = z.object({
  id: z.string().min(1), classification: SourceClassificationSchema, title: z.string().min(1),
  reference: z.string().min(1), sourceTimestamp: z.union([date, z.literal("undated")]),
  accessedOn: date, redistribution: RedistributionStatusSchema,
}).strict();
const SourceObservationSchema = z.object({
  property: z.string().min(1), value: z.union([z.number().finite(), z.string().min(1)]),
  unit: z.string().min(1), sourceId: z.string().min(1),
}).strict();

export const ComponentProvenanceSchema = z.object({
  mode: z.enum(["sourced-asset", "modeled-from-specification", "user-defined"]),
  licence: z.object({
    status: RedistributionStatusSchema,
    reference: z.string().min(1).optional(),
  }).strict(),
  uncertainty: z.array(z.object({
    property: z.string().min(1), statement: z.string().min(1),
  }).strict()).min(1),
  sources: z.array(SourceReferenceSchema).min(1),
  sourceObservations: z.array(SourceObservationSchema).min(1),
}).strict().superRefine((provenance, context) => {
  const sourceIds = new Set(provenance.sources.map(({ id }) => id));
  provenance.sourceObservations.forEach((observation, index) => {
    if (!sourceIds.has(observation.sourceId)) context.addIssue({
      code: "custom", message: `Unknown provenance source: ${observation.sourceId}`,
      path: ["sourceObservations", index, "sourceId"],
    });
  });
});
