import { z } from "zod";

import { EntityIdSchema } from "../cad/model-schema";

const finite = z.number().finite().overwrite((value) => Object.is(value, -0) ? 0 : value);
const positive = finite.positive();
const uint32 = z.number().int().min(0).max(0xffff_ffff)
  .overwrite((value) => Object.is(value, -0) ? 0 : value);
const vector3 = z.tuple([finite, finite, finite]);
const uniqueIds = (minimum: number, message: string, maximum?: number) => {
  const ids = z.array(EntityIdSchema).min(minimum);
  return (maximum === undefined ? ids : ids.max(maximum))
    .refine((values) => new Set(values).size === values.length, message);
};

// Serialized v3/v4 documents used this exact, intentionally unbounded shape.
export const HistoricalMechanismStudySchema = z.object({
  id: EntityIdSchema,
  kind: z.literal("mechanism"),
  instanceIds: uniqueIds(1, "Mechanism study instance IDs must be unique"),
  mateIds: uniqueIds(0, "Mechanism study mate IDs must be unique"),
}).strict();
export const LegacyMechanismStudySchema = HistoricalMechanismStudySchema;

const currentBase = z.object({
  id: EntityIdSchema,
  kind: z.literal("mechanism"),
  instanceIds: uniqueIds(1, "Mechanism study instance IDs must be unique", 256),
  mateIds: uniqueIds(0, "Mechanism study mate IDs must be unique", 256),
}).strict();

const configuredFields = {
  configurationState: z.literal("configured"),
  fixedInstanceIds: uniqueIds(0, "Mechanism fixed instance IDs must be unique", 256),
  materialAssignments: z.array(z.object({
    instanceId: EntityIdSchema,
    materialId: EntityIdSchema,
  }).strict()).min(1).max(256),
  gravityWorldMps2: vector3,
  pointForces: z.array(z.object({
    instanceId: EntityIdSchema,
    pointLocalM: vector3,
    forceWorldN: vector3.refine((force) => force.some((value) => value !== 0), "Mechanism point force must be nonzero"),
  }).strict()).max(256),
  maximumCollisionApproximationErrorM: positive,
  durationSteps: z.number().int().min(1).max(144_000).overwrite((value) => Object.is(value, -0) ? 0 : value),
  outputStrideSteps: z.number().int().min(1).max(144_000).overwrite((value) => Object.is(value, -0) ? 0 : value),
  collisionGroups: z.array(z.object({
    id: EntityIdSchema,
    instanceIds: uniqueIds(1, "Mechanism collision-group instance IDs must be unique", 256),
    membershipMask: uint32.positive(),
    filterMask: uint32,
  }).strict()).max(256),
  clearancePairs: z.array(z.object({
    id: EntityIdSchema,
    firstInstanceId: EntityIdSchema,
    secondInstanceId: EntityIdSchema,
  }).strict().refine(({ firstInstanceId, secondInstanceId }) => firstInstanceId !== secondInstanceId,
    "Mechanism clearance pair must reference distinct instances")).max(512),
};

const versionFiveConfigured = currentBase.extend(configuredFields).strict();
type VersionFiveConfiguredMechanismStudy = z.infer<typeof versionFiveConfigured>;

function addConfiguredIntegrityIssues(study: VersionFiveConfiguredMechanismStudy, context: z.RefinementCtx): void {
  const instances = new Set(study.instanceIds);
  const requireInstance = (instanceId: string, label: string) => {
    if (!instances.has(instanceId)) context.addIssue({ code: "custom", message: `${label} is outside the study: ${instanceId}` });
  };
  for (const instanceId of study.fixedInstanceIds) requireInstance(instanceId, "Mechanism fixed instance");
  for (const force of study.pointForces) requireInstance(force.instanceId, "Mechanism point-force instance");
  const assigned = new Map(study.instanceIds.map((id) => [id, 0]));
  for (const assignment of study.materialAssignments) {
    requireInstance(assignment.instanceId, "Mechanism material-assignment instance");
    if (instances.has(assignment.instanceId)) assigned.set(assignment.instanceId, (assigned.get(assignment.instanceId) ?? 0) + 1);
  }
  for (const [instanceId, count] of assigned) if (count !== 1) {
    context.addIssue({ code: "custom", message: `Mechanism instance must have exactly one material assignment: ${instanceId}` });
  }
  const memberships = new Map(study.instanceIds.map((id) => [id, 0]));
  const groupIds = new Set<string>();
  for (const group of study.collisionGroups) {
    if (groupIds.has(group.id)) context.addIssue({ code: "custom", message: `Duplicate mechanism collision group ID: ${group.id}` });
    groupIds.add(group.id);
    for (const instanceId of group.instanceIds) {
      requireInstance(instanceId, "Mechanism collision-group instance");
      if (instances.has(instanceId)) memberships.set(instanceId, (memberships.get(instanceId) ?? 0) + 1);
    }
  }
  for (const [instanceId, count] of memberships) if (count !== 1) {
    context.addIssue({ code: "custom", message: `Mechanism instance must belong to exactly one collision group: ${instanceId}` });
  }
  const ids = new Set<string>();
  const pairs = new Set<string>();
  for (const pair of study.clearancePairs) {
    requireInstance(pair.firstInstanceId, "Mechanism clearance first instance");
    requireInstance(pair.secondInstanceId, "Mechanism clearance second instance");
    if (ids.has(pair.id)) context.addIssue({ code: "custom", message: `Duplicate mechanism clearance pair ID: ${pair.id}` });
    ids.add(pair.id);
    const key = [pair.firstInstanceId, pair.secondInstanceId].sort().join("/");
    if (pairs.has(key)) context.addIssue({ code: "custom", message: `Mechanism instance pair has multiple clearance queries: ${key}` });
    pairs.add(key);
  }
  if (study.durationSteps % study.outputStrideSteps !== 0) {
    context.addIssue({ code: "custom", message: "Mechanism duration must be divisible by output stride" });
  }
}

const requiresConfiguration = currentBase.extend({ configurationState: z.literal("requires-configuration") }).strict();

export const VersionFiveMechanismStudySchema = z.union([
  requiresConfiguration,
  versionFiveConfigured.superRefine(addConfiguredIntegrityIssues),
]);

const configured = currentBase.extend({
  ...configuredFields,
  initialOverlapPolicy: z.literal("reject-any-positive-volume"),
}).strict().superRefine(addConfiguredIntegrityIssues);

export const MechanismStudySchema = z.union([
  requiresConfiguration,
  configured,
]);

export type MechanismStudy = z.infer<typeof MechanismStudySchema>;
