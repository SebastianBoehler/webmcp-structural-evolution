import { z } from "zod";

import { EntityIdSchema } from "../cad/model-schema";
import {
  HistoricalMechanismStudySchema,
  LegacyMechanismStudySchema,
  MechanismStudySchema,
  VersionFiveMechanismStudySchema,
  type MechanismStudy,
} from "./mechanism-study-schema";

export {
  HistoricalMechanismStudySchema,
  LegacyMechanismStudySchema,
  MechanismStudySchema,
  VersionFiveMechanismStudySchema,
  type MechanismStudy,
} from "./mechanism-study-schema";

const finite = z.number().finite();
const positive = finite.positive();
const ForceVectorSchema = z.tuple([finite, finite, finite]).refine(
  (force) => force.some((component) => component !== 0),
  "Structural load force must be nonzero",
);

function uniqueIdsSchema(minimum: number, message: string, maximum?: number) {
  const ids = z.array(EntityIdSchema).min(minimum);
  return (maximum === undefined ? ids : ids.max(maximum)).refine(
    (ids) => new Set(ids).size === ids.length,
    message,
  );
}

export const MaterialDefinitionSchema = z.object({
  id: EntityIdSchema,
  kind: z.literal("isotropic"),
  densityKgM3: positive,
  youngsModulusPa: positive,
  poissonRatio: finite.gt(-1).lt(0.5),
  failureStressPa: positive,
}).strict();

export const StructuralLoadSchema = z.object({
  selectionId: EntityIdSchema,
  forceN: ForceVectorSchema,
}).strict();
export const StructuralStudySchema = z.object({
  id: EntityIdSchema,
  kind: z.literal("structural-linear"),
  bodyIds: uniqueIdsSchema(1, "Structural study body IDs must be unique"),
  materialId: EntityIdSchema,
  supports: uniqueIdsSchema(1, "Structural support selections must be unique"),
  loads: z.array(StructuralLoadSchema).min(1).superRefine((loads, context) => {
    const selectionIds = new Set<string>();
    for (const [index, load] of loads.entries()) {
      if (selectionIds.has(load.selectionId)) {
        context.addIssue({ code: "custom", path: [index, "selectionId"], message: "Structural load selections must be unique" });
      }
      selectionIds.add(load.selectionId);
    }
  }),
}).strict();
export const LegacyTopologyStudySchema = z.object({
  id: EntityIdSchema,
  kind: z.literal("topology"),
  sourceStudyId: EntityIdSchema,
}).strict();
const TopologyStudyBaseSchema = LegacyTopologyStudySchema.extend({
  objective: z.literal("minimum-compliance"),
  targetVolumeFraction: finite.gt(0).lte(1),
  moveLimit: finite.gt(0).lte(1),
  filterRadiusM: positive,
  minimumFeatureM: positive,
  maxIterations: z.number().int().min(1).max(64),
  extraction: z.object({
    isoValue: finite.gt(0).lt(1),
    toleranceM: positive,
  }).strict(),
  protectedVoidSelectionIds: uniqueIdsSchema(0, "Topology protected-void selections must be unique"),
  acceptance: z.object({
    maximumDisplacementM: positive,
    maximumVonMisesStressPa: positive,
    minimumSafetyFactor: positive,
    maximumMaterialFraction: finite.gt(0).lte(1),
  }).strict(),
});
export const TopologyStudySchema = z.union([
  LegacyTopologyStudySchema.extend({
    configurationState: z.literal("requires-configuration"),
  }).strict(),
  TopologyStudyBaseSchema.extend({
    configurationState: z.literal("configured"),
  }).strict(),
]);
export const ThermalSteadyStudySchema = z.object({
  id: EntityIdSchema,
  kind: z.literal("thermal-steady"),
  bodyIds: uniqueIdsSchema(1, "Thermal study body IDs must be unique"),
  materialId: EntityIdSchema,
}).strict();
export const LegacyStudySchema = z.discriminatedUnion("kind", [
  StructuralStudySchema,
  LegacyTopologyStudySchema,
  HistoricalMechanismStudySchema,
  ThermalSteadyStudySchema,
]);
export const VersionFourStudySchema = z.union([
  StructuralStudySchema,
  TopologyStudySchema,
  HistoricalMechanismStudySchema,
  ThermalSteadyStudySchema,
]);
export const VersionFiveStudySchema = z.union([
  StructuralStudySchema,
  TopologyStudySchema,
  VersionFiveMechanismStudySchema,
  ThermalSteadyStudySchema,
]);
export const StudySchema = z.union([
  StructuralStudySchema,
  TopologyStudySchema,
  MechanismStudySchema,
  ThermalSteadyStudySchema,
]);

export type MaterialDefinition = z.infer<typeof MaterialDefinitionSchema>;
export type StructuralStudy = z.infer<typeof StructuralStudySchema>;
export type TopologyStudy = z.infer<typeof TopologyStudySchema>;
export type ThermalSteadyStudy = z.infer<typeof ThermalSteadyStudySchema>;
export type Study = z.infer<typeof StudySchema>;

export type StudyIntegrityInput = Readonly<{
  bodies: readonly Readonly<{ id: string }>[];
  materials: readonly MaterialDefinition[];
  namedSelections: readonly Readonly<{ id: string; reference: Readonly<{ bodyId: string }> }>[];
  studies: readonly Study[];
  instances: readonly Readonly<{ id: string }>[];
  mates: readonly Readonly<{ id: string; firstInstanceId: string; secondInstanceId: string }>[];
}>;

function addDuplicateIdIssues(
  entries: readonly Readonly<{ id: string }>[],
  label: string,
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) context.addIssue({ code: "custom", message: `Duplicate ${label} ID: ${entry.id}` });
    ids.add(entry.id);
  }
}

function addUnresolvedIssues(
  ids: readonly string[],
  resolved: ReadonlySet<string>,
  label: string,
  context: z.RefinementCtx,
): void {
  for (const id of ids) {
    if (!resolved.has(id)) context.addIssue({ code: "custom", message: `${label} is unresolved: ${id}` });
  }
}

function addStructuralIntegrityIssues(
  study: StructuralStudy,
  bodyIds: ReadonlySet<string>,
  materialIds: ReadonlySet<string>,
  selections: ReadonlyMap<string, { bodyId: string }>,
  context: z.RefinementCtx,
): void {
  addUnresolvedIssues(study.bodyIds, bodyIds, "Body", context);
  addUnresolvedIssues([study.materialId], materialIds, "Material", context);
  const selectionIds = [...study.supports, ...study.loads.map(({ selectionId }) => selectionId)];
  for (const selectionId of selectionIds) {
    const selection = selections.get(selectionId);
    if (!selection) {
      context.addIssue({ code: "custom", message: `Named selection is unresolved: ${selectionId}` });
    } else if (!study.bodyIds.includes(selection.bodyId)) {
      context.addIssue({ code: "custom", message: `Named selection is incompatible with study bodies: ${selectionId}` });
    }
  }
}

export function addStudyIntegrityIssues(value: StudyIntegrityInput, context: z.RefinementCtx): void {
  addDuplicateIdIssues(value.materials, "material", context);
  addDuplicateIdIssues(value.studies, "study", context);

  const bodyIds = new Set(value.bodies.map(({ id }) => id));
  const materialIds = new Set(value.materials.map(({ id }) => id));
  const selections = new Map(value.namedSelections.map((selection) => [selection.id, selection.reference]));
  const studies = new Map(value.studies.map((study) => [study.id, study]));
  const instanceIds = new Set(value.instances.map(({ id }) => id));
  const mateIds = new Set(value.mates.map(({ id }) => id));
  const mates = new Map(value.mates.map((mate) => [mate.id, mate]));

  for (const study of value.studies) {
    switch (study.kind) {
      case "structural-linear":
        addStructuralIntegrityIssues(study, bodyIds, materialIds, selections, context);
        break;
      case "topology": {
        const source = studies.get(study.sourceStudyId);
        if (!source) context.addIssue({ code: "custom", message: `Source study is unresolved: ${study.sourceStudyId}` });
        else if (source.kind !== "structural-linear") {
          context.addIssue({ code: "custom", message: `Topology source study must be structural-linear: ${study.sourceStudyId}` });
        } else if (study.configurationState === "configured") {
          const sourceBodies = new Set(source.bodyIds);
          for (const selectionId of study.protectedVoidSelectionIds) {
            const selection = selections.get(selectionId);
            if (!selection) context.addIssue({ code: "custom", message: `Named selection is unresolved: ${selectionId}` });
            else if (!sourceBodies.has(selection.bodyId)) {
              context.addIssue({ code: "custom", message: `Topology protected-void selection is incompatible with source bodies: ${selectionId}` });
            }
          }
        }
        break;
      }
      case "mechanism":
        addUnresolvedIssues(study.instanceIds, instanceIds, "Instance", context);
        addUnresolvedIssues(study.mateIds, mateIds, "Mate", context);
        if (study.configurationState === "configured") {
          for (const assignment of study.materialAssignments) if (!materialIds.has(assignment.materialId)) {
            context.addIssue({ code: "custom", message: `Mechanism material is unresolved: ${assignment.materialId}` });
          }
        }
        for (const mateId of study.mateIds) {
          const mate = mates.get(mateId);
          if (mate && (!study.instanceIds.includes(mate.firstInstanceId)
            || !study.instanceIds.includes(mate.secondInstanceId))) {
            context.addIssue({ code: "custom", message: `Mechanism mate references an instance outside the study: ${mateId}` });
          }
        }
        break;
      case "thermal-steady":
        addUnresolvedIssues(study.bodyIds, bodyIds, "Body", context);
        addUnresolvedIssues([study.materialId], materialIds, "Material", context);
        break;
    }
  }
}
