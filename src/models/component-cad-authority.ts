import { z } from "zod";

import { DigestSchema } from "../domain/component-geometry";

export const ComponentCadAuthoritySchema = z.enum([
  "parametric-specification-model",
  "digest-verified-step-import",
]);
export type ComponentCadAuthority = z.infer<typeof ComponentCadAuthoritySchema>;

const OwnedStepSchema = z.object({
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, "Owned STEP bytes are required"),
  digest: DigestSchema,
  exactImport: z.literal("succeeded"),
}).strict();

export const ComponentCadSourceSchema = z.discriminatedUnion("authority", [
  z.object({
    authority: z.literal("parametric-specification-model"),
    source: z.enum(["catalog-dimensions", "sourced-dimensions"]),
  }).strict(),
  z.object({ authority: z.literal("digest-verified-step-import"), step: OwnedStepSchema }).strict(),
]);
export type ComponentCadSource = z.infer<typeof ComponentCadSourceSchema>;
