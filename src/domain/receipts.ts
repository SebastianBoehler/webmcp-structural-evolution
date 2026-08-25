import { z } from "zod";

import type { JsonValue } from "./canonical-json";
import { freezeSnapshot, type DeepReadonly } from "./snapshots";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const ActionReceiptSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    validatedInputs: JsonValueSchema,
    affectedRevision: z.string().min(1).nullable(),
    outcome: z.discriminatedUnion("status", [
      z.object({ status: z.literal("succeeded"), result: JsonValueSchema }).strict(),
      z.object({ status: z.literal("failed"), error: z.string().min(1) }).strict(),
    ]),
    duration: z.object({ value: z.number().finite().nonnegative(), unit: z.literal("ms") }).strict(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ActionReceipt = DeepReadonly<z.infer<typeof ActionReceiptSchema>>;

export const defineActionReceipt = (value: unknown): ActionReceipt =>
  freezeSnapshot(ActionReceiptSchema.parse(value));
