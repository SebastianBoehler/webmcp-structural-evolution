import { z } from "zod";

import {
  ComponentGeometrySchema,
  normalizeComponentGeometry,
} from "./component-geometry";
import { ComponentProvenanceSchema } from "./component-provenance";
import {
  ForceVectorSchema,
  LengthVectorSchema,
  MassSchema,
  MountInterfaceSchema,
  normalizeLengthVector,
  normalizeMass,
  normalizeOrientation,
  normalizePositiveLength,
  normalizeVolume,
  OrientationSchema,
  PositiveLengthSchema,
  VolumeSchema,
} from "./engineering-units";
import { defineRevisionedSnapshot, RevisionSchema, type DeepReadonly } from "./snapshots";

export {
  CadMediaTypeSchema,
  ComponentGeometrySchema,
  DigestSchema,
  ParametricGraphSchema,
} from "./component-geometry";
export type { ParametricGraph } from "./component-geometry";
export { ComponentProvenanceSchema } from "./component-provenance";

const ComponentInterfaceBaseSchema = z.object({
  id: z.string().min(1),
  coordinates: z.literal("component-local"),
  position: LengthVectorSchema,
  orientation: OrientationSchema,
}).strict();
const SemanticMountInterfaceSchema = ComponentInterfaceBaseSchema.extend({
  kind: z.literal("mount"), diameter: PositiveLengthSchema, fastenerType: z.string().min(1),
}).strict();
const MateInterfaceSchema = ComponentInterfaceBaseSchema.extend({
  kind: z.literal("mate"),
  mating: z.enum(["planar", "concentric", "axial", "orientation"]),
  diameter: PositiveLengthSchema.optional(),
}).strict();
const CableInterfaceSchema = ComponentInterfaceBaseSchema.extend({
  kind: z.literal("cable"), connector: z.string().min(1),
}).strict();
const AccessInterfaceSchema = ComponentInterfaceBaseSchema.extend({ kind: z.literal("access"), volume: VolumeSchema }).strict();
const CoolingInterfaceSchema = ComponentInterfaceBaseSchema.extend({ kind: z.literal("cooling"), volume: VolumeSchema }).strict();
const LoadInterfaceSchema = ComponentInterfaceBaseSchema.extend({ kind: z.literal("load"), force: ForceVectorSchema }).strict();

export const SemanticInterfaceSchema = z.discriminatedUnion("kind", [
  SemanticMountInterfaceSchema, MateInterfaceSchema, CableInterfaceSchema,
  AccessInterfaceSchema, CoolingInterfaceSchema, LoadInterfaceSchema,
]);

const AnchorSchema = z.object({
  id: z.string().min(1),
  coordinates: z.literal("component-local"),
  position: LengthVectorSchema,
}).strict();

const ComponentDefinitionContentSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1).max(80).regex(
    /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/,
    "Component category must be a lowercase domain path",
  ),
  geometryCoordinates: z.literal("component-local"),
  manufacturer: z.string().min(1),
  partNumber: z.string().min(1),
  provenance: ComponentProvenanceSchema,
  mass: MassSchema,
  massAccounting: z.enum(["standalone", "none"]),
  optimizationRole: z.enum(["fixed-component", "protected"]),
  centerOfMass: LengthVectorSchema,
  anchor: AnchorSchema,
  envelope: VolumeSchema,
  collisionVolumes: z.array(VolumeSchema).min(1),
  protectedVolumes: z.array(VolumeSchema),
  mountInterfaces: z.array(MountInterfaceSchema),
  loadContributions: z.array(z.object({ id: z.string().min(1), force: ForceVectorSchema }).strict()),
  allowedOrientations: z.array(OrientationSchema).min(1),
  geometry: ComponentGeometrySchema,
  interfaces: z.array(SemanticInterfaceSchema).default([]),
}).strict().superRefine((component, context) => {
  if (component.massAccounting === "standalone" && component.mass.value === 0) context.addIssue({
    code: "custom", message: "Standalone component mass must be positive", path: ["mass"],
  });
  if (component.massAccounting === "none" && component.mass.value !== 0) context.addIssue({
    code: "custom", message: "Non-accounted component mass must be zero", path: ["mass"],
  });
});
export const ComponentDefinitionSchema = ComponentDefinitionContentSchema.safeExtend({ revision: RevisionSchema }).strict();

export type ComponentDefinition = DeepReadonly<z.infer<typeof ComponentDefinitionSchema>>;
export const defineComponent = async (value: unknown): Promise<ComponentDefinition> =>
  defineRevisionedSnapshot(ComponentDefinitionContentSchema, value, normalizeComponentDefinition);

function normalizeComponentDefinition(value: z.infer<typeof ComponentDefinitionContentSchema>) {
  return {
    ...value,
    mass: normalizeMass(value.mass),
    centerOfMass: normalizeLengthVector(value.centerOfMass),
    anchor: { ...value.anchor, position: normalizeLengthVector(value.anchor.position) },
    envelope: normalizeVolume(value.envelope),
    collisionVolumes: value.collisionVolumes.map(normalizeVolume),
    protectedVolumes: value.protectedVolumes.map(normalizeVolume),
    mountInterfaces: value.mountInterfaces.map((mount) => ({
      ...mount,
      position: normalizeLengthVector(mount.position),
      orientation: normalizeOrientation(mount.orientation),
      diameter: normalizePositiveLength(mount.diameter),
    })),
    loadContributions: value.loadContributions.map((load) => ({ ...load })),
    allowedOrientations: value.allowedOrientations.map(normalizeOrientation),
    geometry: normalizeComponentGeometry(value.geometry),
    interfaces: value.interfaces.map(normalizeSemanticInterface),
  };
}

function normalizeSemanticInterface(value: z.infer<typeof SemanticInterfaceSchema>) {
  const base = { ...value, position: normalizeLengthVector(value.position), orientation: normalizeOrientation(value.orientation) };
  if (value.kind === "mount") return { ...base, diameter: normalizePositiveLength(value.diameter) };
  if (value.kind === "mate") return value.diameter ? { ...base, diameter: normalizePositiveLength(value.diameter) } : base;
  if (value.kind === "access" || value.kind === "cooling") return { ...base, volume: normalizeVolume(value.volume) };
  return base;
}
