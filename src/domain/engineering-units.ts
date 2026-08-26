import { z } from "zod";

const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const unitValue = <Unit extends string>(unit: Unit, value = finite) =>
  z.object({ value, unit: z.literal(unit) }).strict();

export const LengthUnitSchema = z.enum(["mm", "m"]);
export const LengthSchema = z.discriminatedUnion("unit", [unitValue("mm"), unitValue("m")]);
export const PositiveLengthSchema = z.discriminatedUnion("unit", [
  unitValue("mm", positive),
  unitValue("m", positive),
]);
export const MassSchema = z.discriminatedUnion("unit", [
  unitValue("g", nonnegative),
  unitValue("kg", nonnegative),
]);
export const AngleSchema = z.discriminatedUnion("unit", [unitValue("deg"), unitValue("rad")]);
export const ForceSchema = unitValue("N");
export const PressureSchema = z.discriminatedUnion("unit", [
  unitValue("Pa", positive),
  unitValue("MPa", positive),
]);
export const DensitySchema = z.discriminatedUnion("unit", [
  unitValue("kg/m^3", positive),
  unitValue("g/cm^3", positive),
]);

export const LengthVectorSchema = z.object({ x: LengthSchema, y: LengthSchema, z: LengthSchema }).strict();
export const PositiveLengthVectorSchema = z
  .object({ x: PositiveLengthSchema, y: PositiveLengthSchema, z: PositiveLengthSchema })
  .strict();
export const ForceVectorSchema = z.object({ x: ForceSchema, y: ForceSchema, z: ForceSchema }).strict();
export const OrientationSchema = z.object({ roll: AngleSchema, pitch: AngleSchema, yaw: AngleSchema }).strict();
export const TransformSchema = z.object({ position: LengthVectorSchema, orientation: OrientationSchema }).strict();

const zeroOrientation = {
  roll: { value: 0, unit: "rad" as const },
  pitch: { value: 0, unit: "rad" as const },
  yaw: { value: 0, unit: "rad" as const },
};

export const VolumeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("box"),
    id: z.string().min(1),
    center: LengthVectorSchema,
    size: PositiveLengthVectorSchema,
    orientation: OrientationSchema.default(zeroOrientation),
  }).strict(),
  z.object({
    kind: z.literal("cylinder"),
    id: z.string().min(1),
    center: LengthVectorSchema,
    radius: PositiveLengthSchema,
    height: PositiveLengthSchema,
    orientation: OrientationSchema,
  }).strict(),
]);

// Retained unchanged for legacy design imports and assembly fixtures.
export const MountInterfaceSchema = z.object({
  id: z.string().min(1),
  position: LengthVectorSchema,
  orientation: OrientationSchema,
  diameter: PositiveLengthSchema,
  fastenerType: z.string().min(1),
}).strict();

export const normalizeLength = (value: z.infer<typeof LengthSchema>) => ({
  value: value.unit === "mm" ? value.value / 1_000 : value.value,
  unit: "m" as const,
});
export const normalizePositiveLength = (value: z.infer<typeof PositiveLengthSchema>) => ({
  value: value.unit === "mm" ? value.value / 1_000 : value.value,
  unit: "m" as const,
});
export const normalizeMass = (value: z.infer<typeof MassSchema>) => ({
  value: value.unit === "g" ? value.value / 1_000 : value.value,
  unit: "kg" as const,
});
export const normalizeAngle = (value: z.infer<typeof AngleSchema>) => ({
  value: value.unit === "deg" ? value.value * Math.PI / 180 : value.value,
  unit: "rad" as const,
});
export const normalizePressure = (value: z.infer<typeof PressureSchema>) => ({
  value: value.unit === "MPa" ? value.value * 1_000_000 : value.value,
  unit: "Pa" as const,
});
export const normalizeDensity = (value: z.infer<typeof DensitySchema>) => ({
  value: value.unit === "g/cm^3" ? value.value * 1_000 : value.value,
  unit: "kg/m^3" as const,
});
export const normalizeLengthVector = (value: z.infer<typeof LengthVectorSchema>) => ({
  x: normalizeLength(value.x),
  y: normalizeLength(value.y),
  z: normalizeLength(value.z),
});
export const normalizePositiveLengthVector = (
  value: z.infer<typeof PositiveLengthVectorSchema>,
) => ({
  x: normalizePositiveLength(value.x),
  y: normalizePositiveLength(value.y),
  z: normalizePositiveLength(value.z),
});
export const normalizeOrientation = (value: z.infer<typeof OrientationSchema>) => ({
  roll: normalizeAngle(value.roll),
  pitch: normalizeAngle(value.pitch),
  yaw: normalizeAngle(value.yaw),
});
export const normalizeTransform = (value: z.infer<typeof TransformSchema>) => ({
  position: normalizeLengthVector(value.position),
  orientation: normalizeOrientation(value.orientation),
});
export const normalizeVolume = (value: z.infer<typeof VolumeSchema>) => value.kind === "box"
  ? { ...value, center: normalizeLengthVector(value.center), size: normalizePositiveLengthVector(value.size), orientation: normalizeOrientation(value.orientation) }
  : {
      ...value,
      center: normalizeLengthVector(value.center),
      radius: normalizePositiveLength(value.radius),
      height: normalizePositiveLength(value.height),
      orientation: normalizeOrientation(value.orientation),
    };
export const normalizeMountInterface = (value: z.infer<typeof MountInterfaceSchema>) => ({
  ...value,
  position: normalizeLengthVector(value.position),
  orientation: normalizeOrientation(value.orientation),
  diameter: normalizePositiveLength(value.diameter),
});
