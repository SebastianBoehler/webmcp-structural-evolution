import { z } from "zod";

import { revisionId } from "./revisions";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly [unknown, ...unknown[]]
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export const RevisionSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Revision must be a lowercase SHA-256 digest");

const RevisionedInputSchema = z
  .object({ revision: RevisionSchema.optional() })
  .passthrough();

export function freezeSnapshot<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export async function defineRevisionedSnapshot<Content extends object>(
  contentSchema: z.ZodType<Content>,
  value: unknown,
): Promise<DeepReadonly<Content & { revision: string }>> {
  const candidate = RevisionedInputSchema.parse(value);
  const { revision: claimedRevision, ...unvalidatedContent } = candidate;
  const content = contentSchema.parse(unvalidatedContent);
  const derivedRevision = await revisionId(content);

  if (claimedRevision !== undefined && claimedRevision !== derivedRevision) {
    throw new Error("Revision does not match canonical content");
  }

  return freezeSnapshot({ ...content, revision: derivedRevision });
}
