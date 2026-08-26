import { z } from "zod";

import {
  defineRevisionedSnapshot,
  freezeSnapshot,
  RevisionSchema,
  type DeepReadonly,
} from "./snapshots";

export { freezeSnapshot, type DeepReadonly } from "./snapshots";

const finite = z.number().finite();
const positive = finite.positive();
const unitValue = <Unit extends string>(unit: Unit, value = finite) =>
  z.object({ value, unit: z.literal(unit) }).strict();

export const LengthSchema = z.discriminatedUnion("unit", [
  unitValue("mm"),
  unitValue("m"),
]);
export const PositiveLengthSchema = z.discriminatedUnion("unit", [
  unitValue("mm", positive),
  unitValue("m", positive),
]);
export const MassSchema = z.discriminatedUnion("unit", [
  unitValue("g", positive),
  unitValue("kg", positive),
]);
export const AngleSchema = z.discriminatedUnion("unit", [
  unitValue("deg"),
  unitValue("rad"),
]);
export const ForceSchema = unitValue("N");
export const PressureSchema = unitValue("MPa", positive);
export const DensitySchema = unitValue("g/cm^3", positive);

const LengthVectorSchema = z
  .object({ x: LengthSchema, y: LengthSchema, z: LengthSchema })
  .strict();
const PositiveLengthVectorSchema = z
  .object({ x: PositiveLengthSchema, y: PositiveLengthSchema, z: PositiveLengthSchema })
  .strict();
const ForceVectorSchema = z
  .object({ x: ForceSchema, y: ForceSchema, z: ForceSchema })
  .strict();
const OrientationSchema = z
  .object({ roll: AngleSchema, pitch: AngleSchema, yaw: AngleSchema })
  .strict();
const TransformSchema = z
  .object({ position: LengthVectorSchema, orientation: OrientationSchema })
  .strict();

export const VolumeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("box"),
      id: z.string().min(1),
      center: LengthVectorSchema,
      size: PositiveLengthVectorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("cylinder"),
      id: z.string().min(1),
      center: LengthVectorSchema,
      radius: PositiveLengthSchema,
      height: PositiveLengthSchema,
      orientation: OrientationSchema,
    })
    .strict(),
]);

export const MountInterfaceSchema = z
  .object({
    id: z.string().min(1),
    position: LengthVectorSchema,
    orientation: OrientationSchema,
    diameter: PositiveLengthSchema,
    fastenerType: z.string().min(1),
  })
  .strict();

const ComponentDefinitionContentSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(["motor", "fastener", "body-interface"]),
    geometryCoordinates: z.literal("component-local"),
    manufacturer: z.string().min(1),
    partNumber: z.string().min(1),
    provenance: z
      .object({
        kind: z.enum(["manufacturer-datasheet", "generic", "user-defined"]),
        reference: z.string().min(1),
      })
      .strict(),
    mass: MassSchema,
    centerOfMass: LengthVectorSchema,
    envelope: VolumeSchema,
    mountInterfaces: z.array(MountInterfaceSchema),
    keepOutVolumes: z.array(VolumeSchema),
    loadContributions: z.array(
      z.object({ id: z.string().min(1), force: ForceVectorSchema }).strict(),
    ),
    allowedOrientations: z.array(OrientationSchema).min(1),
  })
  .strict();
export const ComponentDefinitionSchema = ComponentDefinitionContentSchema.extend({
  revision: RevisionSchema,
}).strict();

export const InventoryItemSchema = z
  .object({
    componentRevision: z.string().min(1),
    ownedQuantity: z.number().int().nonnegative(),
    availability: z.enum(["available", "unavailable"]),
    label: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();
export const InventorySchema = z.array(InventoryItemSchema);

const ComponentRequirementSchema = z
  .object({
    instanceId: z.string().min(1),
    componentRevision: z.string().min(1),
    quantity: z.number().int().positive(),
    transform: TransformSchema,
  })
  .strict();

const AssemblySpecContentSchema = z
  .object({
    id: z.string().min(1),
    geometryCoordinates: z.literal("assembly"),
    components: z.array(ComponentRequirementSchema).min(1),
    targetEnvelope: VolumeSchema,
    preservedMounts: z.array(MountInterfaceSchema),
    obstacleVolumes: z.array(VolumeSchema),
    accessVolumes: z.array(VolumeSchema),
    missingComponents: z.array(z.string().min(1)),
    incompatibleComponents: z.array(z.string().min(1)),
    ambiguousComponents: z.array(z.string().min(1)),
  })
  .strict();
export const AssemblySpecSchema = AssemblySpecContentSchema.extend({
  revision: RevisionSchema,
}).strict();

const LoadCaseSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    fixedRegions: z.array(VolumeSchema).min(1),
    forces: z
      .array(
        z.object({ region: VolumeSchema, vector: ForceVectorSchema }).strict(),
      )
      .min(1),
  })
  .strict();

const StudySpecContentSchema = z
  .object({
    id: z.string().min(1),
    assemblyRevision: z.string().min(1),
    geometryCoordinates: z.literal("assembly"),
    designRegion: VolumeSchema,
    voxelResolution: z
      .object({
        x: unitValue("voxels", z.number().int().positive()),
        y: unitValue("voxels", z.number().int().positive()),
        z: unitValue("voxels", z.number().int().positive()),
      })
      .strict(),
    material: z
      .object({
        id: z.string().min(1),
        youngsModulus: PressureSchema,
        poissonRatio: finite.gte(0).lt(0.5),
        density: DensitySchema,
      })
      .strict(),
    manufacturing: z
      .object({
        process: z.literal("fused-filament-fabrication"),
        minimumFeature: LengthSchema,
        buildDirection: z.enum(["x", "y", "z"]),
      })
      .strict(),
    loadCases: z.array(LoadCaseSchema).min(1),
    objective: z
      .object({
        kind: z.literal("minimize-compliance"),
        volumeFraction: finite.gt(0).lte(1),
      })
      .strict(),
    hardLimits: z
      .object({ maximumDisplacement: LengthSchema })
      .strict(),
    deterministicSeed: z.number().int().nonnegative(),
    solverRevision: z.string().min(1),
  })
  .strict();
export const StudySpecSchema = StudySpecContentSchema.extend({
  revision: RevisionSchema,
}).strict();

export type ComponentDefinition = DeepReadonly<z.infer<typeof ComponentDefinitionSchema>>;
export type InventoryItem = DeepReadonly<z.infer<typeof InventoryItemSchema>>;
export type AssemblySpec = DeepReadonly<z.infer<typeof AssemblySpecSchema>>;
export type StudySpec = DeepReadonly<z.infer<typeof StudySpecSchema>>;

export const defineComponent = async (value: unknown): Promise<ComponentDefinition> =>
  defineRevisionedSnapshot(ComponentDefinitionContentSchema, value);
export const defineAssembly = async (value: unknown): Promise<AssemblySpec> =>
  defineRevisionedSnapshot(AssemblySpecContentSchema, value);
export const defineStudy = async (value: unknown): Promise<StudySpec> =>
  defineRevisionedSnapshot(StudySpecContentSchema, value);
export const defineInventory = (value: unknown): readonly InventoryItem[] =>
  freezeSnapshot(InventorySchema.parse(value));

export type InventoryEvaluation = Readonly<{
  status: "buildable" | "insufficient-stock" | "unresolved-assembly";
  shortages: readonly Readonly<{
    componentRevision: string;
    requiredQuantity: number;
    ownedQuantity: number;
    shortfall: number;
  }>[];
  assemblyIssues?: Readonly<{
    missingComponents: readonly string[];
    incompatibleComponents: readonly string[];
    ambiguousComponents: readonly string[];
  }>;
}>;

export function evaluateInventory(
  inventory: readonly InventoryItem[],
  assembly: AssemblySpec,
): InventoryEvaluation {
  const parsedInventory = InventorySchema.parse(inventory);
  const parsedAssembly = AssemblySpecSchema.parse(assembly);
  const owned = new Map<string, number>();
  const required = new Map<string, number>();

  for (const item of parsedInventory) {
    const quantity = item.availability === "available" ? item.ownedQuantity : 0;
    owned.set(item.componentRevision, (owned.get(item.componentRevision) ?? 0) + quantity);
  }
  for (const item of parsedAssembly.components) {
    required.set(
      item.componentRevision,
      (required.get(item.componentRevision) ?? 0) + item.quantity,
    );
  }

  const shortages = [...required]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([componentRevision, requiredQuantity]) => {
      const ownedQuantity = owned.get(componentRevision) ?? 0;
      return ownedQuantity >= requiredQuantity
        ? []
        : [{
            componentRevision,
            requiredQuantity,
            ownedQuantity,
            shortfall: requiredQuantity - ownedQuantity,
          }];
    });

  const assemblyIssues = {
    missingComponents: parsedAssembly.missingComponents,
    incompatibleComponents: parsedAssembly.incompatibleComponents,
    ambiguousComponents: parsedAssembly.ambiguousComponents,
  };
  const hasAssemblyIssues = Object.values(assemblyIssues).some(
    (issues) => issues.length > 0,
  );

  return freezeSnapshot(
    hasAssemblyIssues
      ? { status: "unresolved-assembly", shortages, assemblyIssues }
      : {
          status: shortages.length === 0 ? "buildable" : "insufficient-stock",
          shortages,
        },
  );
}
