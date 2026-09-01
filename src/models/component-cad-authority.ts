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

export async function defineComponentCadSource(value: unknown): Promise<ComponentCadSource> {
  const source = ComponentCadSourceSchema.parse(value);
  if (source.authority !== "digest-verified-step-import") return source;
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", source.step.bytes));
  const actual = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== source.step.digest) throw new Error("Owned STEP bytes digest mismatch");
  return source;
}
