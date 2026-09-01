import { z } from "zod";
import type { DeepReadonly } from "../domain/snapshots";

const finite = z.number().finite();
const uint32 = z.number().int().min(0).max(0xffff_ffff);
const matrix = z.tuple([finite, finite, finite, finite, finite, finite, finite, finite, finite]);
const vector = z.tuple([finite, finite, finite]);
const ownedBytes = z.custom<Uint8Array>((value) =>
  Object.prototype.toString.call(value) === "[object Uint8Array]"
  && Object.prototype.toString.call((value as Uint8Array).buffer) === "[object ArrayBuffer]"
  && (value as Uint8Array).byteOffset === 0
  && (value as Uint8Array).byteLength === (value as Uint8Array).buffer.byteLength
  && (value as Uint8Array).byteLength > 0,
"Expected nonempty owned BREP bytes");

export const ExactPlacedInstanceSchema = z.object({
  instanceId: z.string().min(1), membershipMask: uint32, filterMask: uint32,
  transform: z.object({ positionM: vector, rotation: matrix }).strict(),
  bodyIds: z.array(z.string().min(1)).min(1).max(64)
    .refine((values) => new Set(values).size === values.length, "Placed body IDs must be unique"),
}).strict();
export const ExactSourceBodySchema = z.object({
  bodyId: z.string().min(1), brepBytes: ownedBytes,
}).strict();
const checkRequest = z.object({ type: z.literal("check-overlap"), requestId: z.string().min(1),
  sourceBodies: z.array(ExactSourceBodySchema).min(1).max(512),
  instances: z.array(ExactPlacedInstanceSchema).min(1).max(256),
}).strict().superRefine((request, context) => {
  const sourceIds = request.sourceBodies.map(({ bodyId }) => bodyId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({ code: "custom", message: "Exact source body IDs must be unique" });
  }
  const available = new Set(sourceIds);
  for (const instance of request.instances) for (const bodyId of instance.bodyIds) {
    if (!available.has(bodyId)) context.addIssue({ code: "custom", message: `Placed body is unresolved: ${bodyId}` });
  }
});
export const MechanismOverlapRequestSchema = z.discriminatedUnion("type", [
  checkRequest,
  z.object({ type: z.literal("cancel"), requestId: z.string().min(1) }).strict(),
]);
export const MechanismOverlapEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("succeeded"), requestId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("cancelled"), requestId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("failed"), requestId: z.string().min(1), error: z.string().min(1) }).strict(),
]);

export type ExactPlacedInstance = DeepReadonly<z.infer<typeof ExactPlacedInstanceSchema>>;
export type ExactSourceBody = DeepReadonly<z.infer<typeof ExactSourceBodySchema>>;
export type MechanismOverlapRequest = z.infer<typeof MechanismOverlapRequestSchema>;
export type MechanismOverlapEvent = z.infer<typeof MechanismOverlapEventSchema>;
