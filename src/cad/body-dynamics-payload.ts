import { z } from "zod";

import {
  assertCadResourceLimit,
  CAD_RESOURCE_LIMITS,
} from "./cad-resource-limits";
import { EntityIdSchema } from "./model-schema";
import {
  assertFixedOwnedView,
  inspectFixedOwnedPayload,
} from "./fixed-owned-payload";

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const inertia = z.tuple([
  finite, finite, finite,
  finite, finite, finite,
  finite, finite, finite,
]);
const uint8 = z.custom<Uint8Array>((value) => {
  try {
    assertFixedOwnedView(value, "Uint8Array");
    if ((value as Uint8Array).byteLength === 0) throw new TypeError("Body BREP is empty");
    return true;
  } catch {
    return false;
  }
}, "Expected an owned fixed Uint8Array");

const codeUnitCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const symmetryTolerance = Number.EPSILON * 64 + 1e-9;

function symmetricPair(left: number, right: number): boolean {
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return scale === 0 || Math.abs(left / scale - right / scale) <= symmetryTolerance;
}

function isSymmetric(tensor: readonly number[]): boolean {
  return [[1, 3], [2, 6], [5, 7]].every(([left, right]) =>
    symmetricPair(tensor[left!]!, tensor[right!]!));
}

function isPositiveDefinite(tensor: readonly number[]): boolean {
  const scale = Math.max(...tensor.map(Math.abs));
  if (!(scale > 0)) return false;
  const normalized = tensor.map((value) => value / scale);
  const a = normalized[0]!;
  const d = (normalized[1]! + normalized[3]!) / 2;
  const e = normalized[4]!;
  const g = (normalized[2]! + normalized[6]!) / 2;
  const h = (normalized[5]! + normalized[7]!) / 2;
  const i = normalized[8]!;
  if (!(a > 0)) return false;
  const l11 = Math.sqrt(a);
  const l21 = d / l11;
  const l31 = g / l11;
  const l22Squared = e - l21 * l21;
  if (!(l22Squared > 0)) return false;
  const l22 = Math.sqrt(l22Squared);
  const l32 = (h - l31 * l21) / l22;
  return i - l31 * l31 - l32 * l32 > 0;
}

function rawBodies(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== "object" || !("bodies" in value)) return undefined;
  const bodies = (value as { bodies?: unknown }).bodies;
  return Array.isArray(bodies) ? bodies : undefined;
}

export function assertBodyDynamicsPayloadLimits(value: unknown): void {
  const bodies = rawBodies(value);
  if (!bodies) return;
  assertCadResourceLimit("body dynamics bodies", bodies.length, CAD_RESOURCE_LIMITS.bodyDynamicsBodies);
  assertCadResourceLimit(
    "body dynamics BREP bytes", inspectFixedOwnedPayload(value),
    CAD_RESOURCE_LIMITS.bodyDynamicsBrepBytes,
  );
}

const BodyDynamicsEntrySchema = z.object({
  bodyId: EntityIdSchema,
  brep: z.object({ bytes: uint8 }).strict(),
  volumeM3: finite.positive(),
  centerOfMassM: vec3,
  centroidalInertiaUnitDensityKgM2: inertia,
}).strict().superRefine((body, context) => {
  const tensor = body.centroidalInertiaUnitDensityKgM2;
  if (!isSymmetric(tensor)) {
    context.addIssue({ code: "custom", path: ["centroidalInertiaUnitDensityKgM2"], message: "Centroidal inertia must be symmetric" });
  } else if (!isPositiveDefinite(tensor)) {
    context.addIssue({ code: "custom", path: ["centroidalInertiaUnitDensityKgM2"], message: "Centroidal inertia must be positive definite" });
  }
});

const BodyDynamicsPayloadObjectSchema = z.object({
  bodies: z.array(BodyDynamicsEntrySchema).min(1),
}).strict().superRefine(({ bodies }, context) => {
  const ids = bodies.map(({ bodyId }) => bodyId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["bodies"], message: "Body dynamics IDs must be unique" });
  }
  const ordered = [...ids].sort(codeUnitCompare);
  if (ids.some((id, index) => id !== ordered[index])) {
    context.addIssue({ code: "custom", path: ["bodies"], message: "Body dynamics must use stable code-unit order" });
  }
});

export const BodyDynamicsPayloadSchema = z.unknown().transform((value, context) => {
  try {
    assertBodyDynamicsPayloadLimits(value);
    return value;
  } catch (error) {
    if (error instanceof Error) {
      context.addIssue({ code: "custom", message: error.message });
      return z.NEVER;
    }
    throw error;
  }
}).pipe(BodyDynamicsPayloadObjectSchema);

export function assertBodyDynamicsCoverage(
  payload: BodyDynamicsPayload,
  requestedBodyIds: readonly string[],
): void {
  const expected = [...requestedBodyIds].sort(codeUnitCompare);
  const actual = payload.bodies.map(({ bodyId }) => bodyId);
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error("Body dynamics payload does not provide unique full document body coverage");
  }
}

export type BodyDynamicsPayload = z.infer<typeof BodyDynamicsPayloadObjectSchema>;
