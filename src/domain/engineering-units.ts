import { z } from "zod";

const finite = z.number().finite();
const positive = finite.positive();
const unitValue = <Unit extends string>(unit: Unit, value = finite) =>
  z.object({ value, unit: z.literal(unit) }).strict();

export const LengthUnitSchema = z.enum(["mm", "m"]);
export const LengthSchema = z.discriminatedUnion("unit", [unitValue("mm"), unitValue("m")]);
export const PositiveLengthSchema = z.discriminatedUnion("unit", [
  unitValue("mm", positive),
  unitValue("m", positive),
]);
export const MassSchema = z.discriminatedUnion("unit", [
  unitValue("g", positive),
  unitValue("kg", positive),
]);
export const AngleSchema = z.discriminatedUnion("unit", [unitValue("deg"), unitValue("rad")]);
export const ForceSchema = unitValue("N");
export const PressureSchema = unitValue("MPa", positive);
export const DensitySchema = unitValue("g/cm^3", positive);

export const LengthVectorSchema = z.object({ x: LengthSchema, y: LengthSchema, z: LengthSchema }).strict();
export const PositiveLengthVectorSchema = z
  .object({ x: PositiveLengthSchema, y: PositiveLengthSchema, z: PositiveLengthSchema })
  .strict();
export const ForceVectorSchema = z.object({ x: ForceSchema, y: ForceSchema, z: ForceSchema }).strict();
export const OrientationSchema = z.object({ roll: AngleSchema, pitch: AngleSchema, yaw: AngleSchema }).strict();
export const TransformSchema = z.object({ position: LengthVectorSchema, orientation: OrientationSchema }).strict();

export const VolumeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("box"),
    id: z.string().min(1),
    center: LengthVectorSchema,
    size: PositiveLengthVectorSchema,
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
