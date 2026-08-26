import { z } from "zod";

import {
  ForceVectorSchema,
  LengthVectorSchema,
  MassSchema,
  MountInterfaceSchema,
  LengthUnitSchema,
  normalizeLengthVector,
  normalizeMass,
  normalizeOrientation,
  normalizePositiveLength,
  normalizePositiveLengthVector,
  normalizeTransform,
  normalizeVolume,
  OrientationSchema,
  PositiveLengthSchema,
  PositiveLengthVectorSchema,
  TransformSchema,
  VolumeSchema,
} from "./engineering-units";
import { defineRevisionedSnapshot, RevisionSchema, type DeepReadonly } from "./snapshots";

export const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/, "Digest must be a lowercase SHA-256 digest");
export const CadMediaTypeSchema = z.enum([
  "model/gltf-binary", "model/gltf+json", "model/obj", "model/stl", "model/3mf", "model/step",
]);

const GraphBoxSchema = z.object({
  kind: z.literal("box"), id: z.string().min(1), center: LengthVectorSchema, size: PositiveLengthVectorSchema,
}).strict();
const GraphCylinderSchema = z.object({
  kind: z.literal("cylinder"),
  id: z.string().min(1),
  center: LengthVectorSchema,
  radius: PositiveLengthSchema,
  height: PositiveLengthSchema,
  orientation: OrientationSchema,
}).strict();
const GraphTransformSchema = z.object({
  kind: z.literal("transform"), id: z.string().min(1), source: z.string().min(1), transform: TransformSchema,
}).strict();
const GraphExtrudeSchema = z.object({
  kind: z.literal("extrude"), id: z.string().min(1), profile: z.string().min(1), height: PositiveLengthSchema,
}).strict();
const GraphRevolveSchema = z.object({
  kind: z.literal("revolve"), id: z.string().min(1), profile: z.string().min(1), axis: z.enum(["x", "y", "z"]),
}).strict();
const graphBinaryOperation = (kind: "union" | "intersection" | "subtraction") => z.object({
  kind: z.literal(kind), id: z.string().min(1), left: z.string().min(1), right: z.string().min(1),
}).strict();
const GraphFilletSchema = z.object({
  kind: z.literal("fillet"), id: z.string().min(1), source: z.string().min(1), radius: PositiveLengthSchema,
}).strict();
const GraphNamedInterfaceSchema = z.object({
  kind: z.literal("named-interface"), id: z.string().min(1), source: z.string().min(1),
}).strict();

export const ParametricGraphSchema = z.object({
  nodes: z.array(z.discriminatedUnion("kind", [
    GraphBoxSchema,
    GraphCylinderSchema,
    GraphTransformSchema,
    GraphExtrudeSchema,
    GraphRevolveSchema,
    graphBinaryOperation("union"),
    graphBinaryOperation("intersection"),
    graphBinaryOperation("subtraction"),
    GraphFilletSchema,
    GraphNamedInterfaceSchema,
  ])).min(1),
}).strict();
export type ParametricGraph = DeepReadonly<z.infer<typeof ParametricGraphSchema>>;

export const ComponentGeometrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), assetId: DigestSchema, mediaType: CadMediaTypeSchema, units: LengthUnitSchema }).strict(),
  z.object({ kind: z.literal("parametric"), graph: ParametricGraphSchema }).strict(),
]);

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
  kind: z.literal("mate"), mating: z.enum(["planar", "concentric", "axial", "orientation"]),
}).strict();
const CableInterfaceSchema = ComponentInterfaceBaseSchema.extend({
  kind: z.literal("cable"), connector: z.string().min(1),
}).strict();
const AccessInterfaceSchema = ComponentInterfaceBaseSchema.extend({ kind: z.literal("access"), volume: VolumeSchema }).strict();
const CoolingInterfaceSchema = ComponentInterfaceBaseSchema.extend({ kind: z.literal("cooling"), volume: VolumeSchema }).strict();
const LoadInterfaceSchema = ComponentInterfaceBaseSchema.extend({ kind: z.literal("load"), force: ForceVectorSchema }).strict();

export const SemanticInterfaceSchema = z.discriminatedUnion("kind", [
  SemanticMountInterfaceSchema,
  MateInterfaceSchema,
  CableInterfaceSchema,
  AccessInterfaceSchema,
  CoolingInterfaceSchema,
  LoadInterfaceSchema,
]);

const ComponentDefinitionContentSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["motor", "fastener", "body-interface"]),
  geometryCoordinates: z.literal("component-local"),
  manufacturer: z.string().min(1),
  partNumber: z.string().min(1),
  provenance: z.object({
    kind: z.enum(["manufacturer-datasheet", "generic", "user-defined"]), reference: z.string().min(1),
  }).strict(),
  mass: MassSchema,
  centerOfMass: LengthVectorSchema,
  envelope: VolumeSchema,
  mountInterfaces: z.array(MountInterfaceSchema),
  keepOutVolumes: z.array(VolumeSchema),
  loadContributions: z.array(z.object({ id: z.string().min(1), force: ForceVectorSchema }).strict()),
  allowedOrientations: z.array(OrientationSchema).min(1),
  geometry: ComponentGeometrySchema.optional(),
  interfaces: z.array(SemanticInterfaceSchema).default([]),
}).strict();
export const ComponentDefinitionSchema = ComponentDefinitionContentSchema.extend({ revision: RevisionSchema }).strict();

export type ComponentDefinition = DeepReadonly<z.infer<typeof ComponentDefinitionSchema>>;
export const defineComponent = async (value: unknown): Promise<ComponentDefinition> =>
  defineRevisionedSnapshot(ComponentDefinitionContentSchema, value, normalizeComponentDefinition);
export const defineLegacyComponent = async (value: unknown): Promise<ComponentDefinition> =>
  defineRevisionedSnapshot(ComponentDefinitionContentSchema, value);

function normalizeComponentDefinition(value: z.infer<typeof ComponentDefinitionContentSchema>) {
  return {
    ...value,
    mass: normalizeMass(value.mass),
    centerOfMass: normalizeLengthVector(value.centerOfMass),
    envelope: normalizeVolume(value.envelope),
    mountInterfaces: value.mountInterfaces.map((mount) => ({
      ...mount,
      position: normalizeLengthVector(mount.position),
      orientation: normalizeOrientation(mount.orientation),
      diameter: normalizePositiveLength(mount.diameter),
    })),
    keepOutVolumes: value.keepOutVolumes.map(normalizeVolume),
    loadContributions: value.loadContributions.map((load) => ({ ...load })),
    allowedOrientations: value.allowedOrientations.map(normalizeOrientation),
    geometry: value.geometry && normalizeComponentGeometry(value.geometry),
    interfaces: value.interfaces.map(normalizeSemanticInterface),
  };
}

function normalizeComponentGeometry(value: z.infer<typeof ComponentGeometrySchema>) {
  return value.kind === "asset"
    ? value
    : { ...value, graph: { nodes: value.graph.nodes.map(normalizeGraphNode) } };
}

function normalizeGraphNode(value: z.infer<typeof ParametricGraphSchema>["nodes"][number]) {
  switch (value.kind) {
    case "box":
      return { ...value, center: normalizeLengthVector(value.center), size: normalizePositiveLengthVector(value.size) };
    case "cylinder":
      return {
        ...value,
        center: normalizeLengthVector(value.center),
        radius: normalizePositiveLength(value.radius),
        height: normalizePositiveLength(value.height),
        orientation: normalizeOrientation(value.orientation),
      };
    case "transform":
      return { ...value, transform: normalizeTransform(value.transform) };
    case "extrude":
      return { ...value, height: normalizePositiveLength(value.height) };
    case "fillet":
      return { ...value, radius: normalizePositiveLength(value.radius) };
    default:
      return value;
  }
}

function normalizeSemanticInterface(value: z.infer<typeof SemanticInterfaceSchema>) {
  const base = {
    ...value,
    position: normalizeLengthVector(value.position),
    orientation: normalizeOrientation(value.orientation),
  };

  switch (value.kind) {
    case "mount":
      return { ...base, diameter: normalizePositiveLength(value.diameter) };
    case "access":
    case "cooling":
      return { ...base, volume: normalizeVolume(value.volume) };
    case "load":
      return { ...base, force: value.force };
    default:
      return base;
  }
}
