import { z } from "zod";

import {
  AssemblySpecSchema,
  defineLegacyAssembly,
  type AssemblySpec,
} from "./assembly-model";
import { defineLegacyComponent } from "./component-model";
import {
  DensitySchema,
  ForceVectorSchema,
  PositiveLengthSchema,
  PressureSchema,
  VolumeSchema,
} from "./engineering-units";
import {
  defineRevisionedSnapshot,
  freezeSnapshot,
  RevisionSchema,
  type DeepReadonly,
} from "./snapshots";

export * from "./assembly-model";
export * from "./component-model";
export * from "./engineering-units";
export { freezeSnapshot, type DeepReadonly } from "./snapshots";

// Old design imports retain their source-unit snapshots; new callers import the
// SI-normalizing constructors from the focused domain modules.
export const defineComponent = defineLegacyComponent;
export const defineAssembly = defineLegacyAssembly;

const finite = z.number().finite();
const unitValue = <Unit extends string>(unit: Unit, value = finite) =>
  z.object({ value, unit: z.literal(unit) }).strict();

export const InventoryItemSchema = z.object({
  componentRevision: z.string().min(1),
  ownedQuantity: z.number().int().nonnegative(),
  availability: z.enum(["available", "unavailable"]),
  label: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
}).strict();
export const InventorySchema = z.array(InventoryItemSchema);

const LoadCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fixedRegions: z.array(VolumeSchema).min(1),
  forces: z.array(z.object({ region: VolumeSchema, vector: ForceVectorSchema }).strict()).min(1),
}).strict();
const StudySpecContentSchema = z.object({
  id: z.string().min(1),
  assemblyRevision: z.string().min(1),
  geometryCoordinates: z.literal("assembly"),
  designRegion: VolumeSchema,
  voxelResolution: z.object({
    x: unitValue("voxels", z.number().int().positive()),
    y: unitValue("voxels", z.number().int().positive()),
    z: unitValue("voxels", z.number().int().positive()),
  }).strict(),
  material: z.object({
    id: z.string().min(1),
    youngsModulus: PressureSchema,
    poissonRatio: finite.gte(0).lt(0.5),
    density: DensitySchema,
  }).strict(),
  manufacturing: z.object({
    process: z.literal("fused-filament-fabrication"),
    minimumFeature: PositiveLengthSchema,
    buildDirection: z.enum(["x", "y", "z"]),
  }).strict(),
  loadCases: z.array(LoadCaseSchema).min(1),
  objective: z.object({ kind: z.literal("minimize-compliance"), volumeFraction: finite.gt(0).lte(1) }).strict(),
  hardLimits: z.object({ maximumDisplacement: PositiveLengthSchema }).strict(),
  deterministicSeed: z.number().int().nonnegative(),
  solverRevision: z.string().min(1),
}).strict();
export const StudySpecSchema = StudySpecContentSchema.extend({ revision: RevisionSchema }).strict();

export type InventoryItem = DeepReadonly<z.infer<typeof InventoryItemSchema>>;
export type StudySpec = DeepReadonly<z.infer<typeof StudySpecSchema>>;
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
    required.set(item.componentRevision, (required.get(item.componentRevision) ?? 0) + item.quantity);
  }

  const shortages = [...required].sort(([left], [right]) => left.localeCompare(right)).flatMap(
    ([componentRevision, requiredQuantity]) => {
      const ownedQuantity = owned.get(componentRevision) ?? 0;
      return ownedQuantity >= requiredQuantity ? [] : [{
        componentRevision,
        requiredQuantity,
        ownedQuantity,
        shortfall: requiredQuantity - ownedQuantity,
      }];
    },
  );
  const assemblyIssues = {
    missingComponents: parsedAssembly.missingComponents,
    incompatibleComponents: parsedAssembly.incompatibleComponents,
    ambiguousComponents: parsedAssembly.ambiguousComponents,
  };
  const hasAssemblyIssues = Object.values(assemblyIssues).some((issues) => issues.length > 0);

  return freezeSnapshot(hasAssemblyIssues
    ? { status: "unresolved-assembly", shortages, assemblyIssues }
    : { status: shortages.length === 0 ? "buildable" : "insufficient-stock", shortages });
}
