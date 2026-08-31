import { z } from "zod";

export const MECHANISM_UNIT_TOLERANCE = 1e-6;
const rawFinite = z.number().finite();
export const finite = rawFinite.overwrite((value) => Object.is(value, -0) ? 0 : value);
export const canonicalFinite = rawFinite.refine(
  (value) => !Object.is(value, -0),
  "Mechanism output must not contain signed zero",
);
export const MechanismVector3Schema = z.tuple([finite, finite, finite]);
export const MechanismOutputVector3Schema = z.tuple([
  canonicalFinite, canonicalFinite, canonicalFinite,
]);

function normalizedComponents<const Values extends readonly number[]>(values: Values): Values | undefined {
  const scale = Math.max(...values.map(Math.abs));
  if (scale === 0 || !Number.isFinite(scale)) return undefined;
  const scaled = values.map((value) => value / scale);
  const magnitude = Math.hypot(...scaled);
  if (magnitude === 0 || !Number.isFinite(magnitude)) return undefined;
  const normalized = scaled.map((value) => value / magnitude) as unknown as Values;
  return normalized.every(Number.isFinite) && normalized.some((value) => value !== 0) ? normalized : undefined;
}

function canonicalQuaternion(quaternion: readonly [number, number, number, number]) {
  let normalized = normalizedComponents(quaternion);
  if (!normalized) return undefined;
  const leading = [normalized[3], normalized[0], normalized[1], normalized[2]].find((value) => value !== 0);
  if (leading !== undefined && leading < 0) {
    normalized = normalized.map((value) => -value) as unknown as typeof normalized;
  }
  return normalized.map((value) => Object.is(value, -0) ? 0 : value) as unknown as typeof normalized;
}

export const MechanismInputQuaternionSchema = z.tuple([finite, finite, finite, finite])
  .transform((quaternion, context) => {
    const canonical = canonicalQuaternion(quaternion);
    if (!canonical) {
      context.addIssue({ code: "custom", message: "Mechanism quaternion must be nonzero" });
      return z.NEVER;
    }
    return canonical;
  });
export const MechanismOutputQuaternionSchema = z.tuple([
  canonicalFinite, canonicalFinite, canonicalFinite, canonicalFinite,
]).superRefine((quaternion, context) => {
  const leading = [quaternion[3], quaternion[0], quaternion[1], quaternion[2]].find((value) => value !== 0);
  if (Math.abs(Math.hypot(...quaternion) - 1) > MECHANISM_UNIT_TOLERANCE
    || leading === undefined || leading < 0) {
    context.addIssue({ code: "custom", message: "Mechanism output quaternion must be unit and canonical" });
  }
});

export const MechanismInputTransformSchema = z.object({
  positionM: MechanismVector3Schema,
  orientation: MechanismInputQuaternionSchema,
}).strict();

/** Unit direction expressed in the local frame named by its owning field. */
export const MechanismDirectionSchema = MechanismVector3Schema
  .transform((axis, context) => {
    const normalized = normalizedComponents(axis);
    if (!normalized) {
      context.addIssue({ code: "custom", message: "Mechanism direction must produce a finite nonzero unit vector" });
      return z.NEVER;
    }
    return normalized.map((value) => Object.is(value, -0) ? 0 : value) as [number, number, number];
  });

export function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalPair(first: string, second: string): readonly [string, string] {
  return codeUnitCompare(first, second) <= 0 ? [first, second] : [second, first];
}
