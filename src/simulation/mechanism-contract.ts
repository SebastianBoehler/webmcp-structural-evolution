import { z } from "zod";

import { EntityIdSchema } from "../cad/model-schema";
import { canonicalJson } from "../domain/canonical-json";
import { revisionId } from "../domain/revisions";
import { freezeSnapshot, RevisionSchema, type DeepReadonly } from "../domain/snapshots";
import {
  defineMechanismCollider, MechanismColliderSchema, type MechanismCollider,
} from "./mechanism-collider";
import {
  canonicalFinite, canonicalPair, codeUnitCompare, finite, MechanismDirectionSchema,
  MechanismInputQuaternionSchema, MechanismInputTransformSchema, MechanismOutputQuaternionSchema,
  MechanismOutputVector3Schema, MechanismVector3Schema, MECHANISM_UNIT_TOLERANCE,
} from "./mechanism-math";

export { MECHANISM_UNIT_TOLERANCE } from "./mechanism-math";
export const MECHANISM_STEP_HZ = 240;
export const MECHANISM_REPLAY_ENCODING_VERSION = "mechanism-replay-v1";
export const MECHANISM_CONTACT_DEPTH_TOLERANCE_M = 1e-6;
export const MECHANISM_MAX_CONTACT_EVENTS = 65_536;
export const MECHANISM_MAX_CLEARANCE_SAMPLES = 65_536;
export const MECHANISM_MAX_REPLAY_FRAMES = 65_536;
export const MECHANISM_MAX_REPLAY_BODY_STATES = 100_000;
export const MECHANISM_MAX_REPLAY_JOINT_STATES = 32_768;
const MAX_BODIES = 256;
const MAX_COLLIDERS = 512;
const MAX_SOURCE_BODIES_PER_BODY = 64;
const MAX_DURATION_STEPS = MECHANISM_STEP_HZ * 60 * 10;
const positive = finite.positive();
const idList = (maximum: number) => z.array(EntityIdSchema).max(maximum);
const outputStepIndex = z.number().int().nonnegative().max(MAX_DURATION_STEPS)
  .refine((value) => !Object.is(value, -0), "Mechanism output must not contain signed zero");
const sourceBodyIds = z.array(EntityIdSchema).min(1).max(MAX_SOURCE_BODIES_PER_BODY)
  .refine((ids) => new Set(ids).size === ids.length, "Mechanism source body IDs must be unique");

const fixedBody = z.object({
  id: EntityIdSchema, kind: z.literal("fixed"), sourceBodyIds,
  transform: MechanismInputTransformSchema,
}).strict();
const dynamicBody = z.object({
  id: EntityIdSchema, kind: z.literal("dynamic"), sourceBodyIds,
  transform: MechanismInputTransformSchema,
  massKg: positive, centerOfMassM: MechanismVector3Schema,
  principalInertiaKgM2: z.tuple([positive, positive, positive]).refine(
    ([first, second, third]) => first <= second + third && second <= first + third && third <= first + second,
    "Principal inertia must satisfy triangle inequalities",
  ),
  // Rotation from the principal-inertia frame into the runtime body-local frame.
  principalInertiaFrameToBody: MechanismInputQuaternionSchema,
  initialLinearVelocityMps: MechanismVector3Schema,
  initialAngularVelocityRadS: MechanismVector3Schema,
}).strict();
export const MechanismBodySchema = z.discriminatedUnion("kind", [fixedBody, dynamicBody]);

const jointBase = {
  id: EntityIdSchema, firstBodyId: EntityIdSchema, secondBodyId: EntityIdSchema,
  firstAnchorLocalM: MechanismVector3Schema, secondAnchorLocalM: MechanismVector3Schema,
};
const RevoluteJointSchema = z.object({
  ...jointBase, kind: z.literal("revolute"),
  // Unit joint axes expressed in the corresponding owning body's local frame.
  firstAxisLocal: MechanismDirectionSchema, secondAxisLocal: MechanismDirectionSchema,
  lowerRad: finite, upperRad: finite,
}).strict().superRefine((joint, context) => {
  if (joint.lowerRad > joint.upperRad) {
    context.addIssue({ code: "custom", message: "Joint lowerRad must not exceed upperRad" });
  }
});
const PrismaticJointSchema = z.object({
  ...jointBase, kind: z.literal("prismatic"),
  firstAxisLocal: MechanismDirectionSchema, secondAxisLocal: MechanismDirectionSchema,
  lowerM: finite, upperM: finite,
}).strict().superRefine((joint, context) => {
  if (joint.lowerM > joint.upperM) {
    context.addIssue({ code: "custom", message: "Joint lowerM must not exceed upperM" });
  }
});
export const MechanismJointSchema = z.union([
  RevoluteJointSchema, PrismaticJointSchema,
  z.object({
    ...jointBase, kind: z.literal("rigid"),
    // Joint-frame orientations expressed in the corresponding owning body's local frame.
    firstFrameOrientationBody: MechanismInputQuaternionSchema,
    secondFrameOrientationBody: MechanismInputQuaternionSchema,
  }).strict(),
]);

export const MechanismPointForceSchema = z.object({
  bodyId: EntityIdSchema, pointLocalM: MechanismVector3Schema,
  forceWorldN: MechanismVector3Schema.refine((force) => force.some((value) => value !== 0), "Point force must be nonzero"),
}).strict();
export const MechanismClearancePairSchema = z.object({
  id: EntityIdSchema, sourceQueryId: EntityIdSchema,
  firstColliderId: EntityIdSchema, secondColliderId: EntityIdSchema,
}).strict().refine(({ firstColliderId, secondColliderId }) => firstColliderId !== secondColliderId,
  "Clearance pair must reference distinct colliders");

const inputShape = {
  sourceRevision: RevisionSchema, studyId: EntityIdSchema,
  bodies: z.array(MechanismBodySchema).min(1).max(MAX_BODIES),
  joints: z.array(MechanismJointSchema).max(MAX_BODIES),
  gravityWorldMps2: MechanismVector3Schema,
  pointForces: z.array(MechanismPointForceSchema).max(MAX_BODIES),
  durationSteps: z.number().int().min(1).max(MAX_DURATION_STEPS),
  outputStrideSteps: z.number().int().min(1).max(MAX_DURATION_STEPS),
  clearancePairs: z.array(MechanismClearancePairSchema).max(MAX_COLLIDERS),
};
const MechanismInputCandidateSchema = z.object({
  ...inputShape, colliders: z.array(z.unknown()).min(1).max(MAX_COLLIDERS),
  truthLevel: z.literal("unverified-mechanism-input").optional(),
  mechanismInputDigest: RevisionSchema.optional(),
}).strict();
const MechanismInputContentSchema = z.object({
  ...inputShape, colliders: z.array(MechanismColliderSchema).min(1).max(MAX_COLLIDERS),
  truthLevel: z.literal("unverified-mechanism-input"),
}).strict().superRefine((input, context) => {
  const unique = (entries: readonly { id: string }[], label: string) => {
    const ids = new Set<string>();
    for (const { id } of entries) {
      if (ids.has(id)) context.addIssue({ code: "custom", message: `Duplicate ${label} ID: ${id}` });
      ids.add(id);
    }
    return ids;
  };
  const bodies = unique(input.bodies, "mechanism body");
  const colliders = unique(input.colliders, "mechanism collider");
  unique(input.joints, "mechanism joint");
  unique(input.clearancePairs, "clearance pair");
  const jointPairs = new Set<string>();
  for (const joint of input.joints) {
    if (!bodies.has(joint.firstBodyId) || !bodies.has(joint.secondBodyId)) {
      context.addIssue({ code: "custom", message: `Mechanism joint references an unknown body: ${joint.id}` });
    }
    if (joint.firstBodyId === joint.secondBodyId) {
      context.addIssue({ code: "custom", message: `Mechanism joint must connect distinct bodies: ${joint.id}` });
    }
    const key = canonicalPair(joint.firstBodyId, joint.secondBodyId).join("/");
    if (jointPairs.has(key)) context.addIssue({ code: "custom", message: `Mechanism body pair has multiple joints: ${key}` });
    jointPairs.add(key);
  }
  for (const bodyId of bodies) if (!input.colliders.some((collider) => collider.bodyId === bodyId)) {
    context.addIssue({ code: "custom", message: `Mechanism body has no collider: ${bodyId}` });
  }
  for (const body of input.bodies) for (const sourceBodyId of body.sourceBodyIds) {
    if (!input.colliders.some((collider) => collider.bodyId === body.id && collider.sourceBodyId === sourceBodyId)) {
      context.addIssue({ code: "custom", message: `Mechanism source body has no collider: ${sourceBodyId}` });
    }
  }
  for (const force of input.pointForces) if (!bodies.has(force.bodyId)) {
    context.addIssue({ code: "custom", message: `Point force body is unknown: ${force.bodyId}` });
  }
  const clearancePairs = new Set<string>();
  for (const pair of input.clearancePairs) {
    if (!colliders.has(pair.firstColliderId) || !colliders.has(pair.secondColliderId)) {
      context.addIssue({ code: "custom", message: `Clearance query references an unknown collider: ${pair.id}` });
    }
    const key = canonicalPair(pair.firstColliderId, pair.secondColliderId).join("/");
    if (clearancePairs.has(key)) context.addIssue({ code: "custom", message: `Mechanism collider pair has multiple clearance queries: ${key}` });
    clearancePairs.add(key);
  }
  if (input.durationSteps % input.outputStrideSteps !== 0) {
    context.addIssue({ code: "custom", message: "Mechanism duration must be divisible by output stride" });
  }
  const frameCount = input.durationSteps / input.outputStrideSteps + 1;
  if (frameCount > MECHANISM_MAX_REPLAY_FRAMES) {
    context.addIssue({ code: "custom", message: "Mechanism replay frame budget exceeded" });
  } else if (frameCount * input.bodies.length > MECHANISM_MAX_REPLAY_BODY_STATES) {
    context.addIssue({ code: "custom", message: "Mechanism replay body-state budget exceeded" });
  } else if (frameCount * input.joints.length > MECHANISM_MAX_REPLAY_JOINT_STATES) {
    context.addIssue({ code: "custom", message: "Mechanism replay joint-state budget exceeded" });
  } else if (frameCount * input.clearancePairs.length > MECHANISM_MAX_CLEARANCE_SAMPLES) {
    context.addIssue({ code: "custom", message: "Mechanism replay clearance-sample budget exceeded" });
  }
});
export const MechanismInputSchema = MechanismInputContentSchema.safeExtend({ mechanismInputDigest: RevisionSchema }).strict();

const byId = <Entry extends { id: string }>(entries: readonly Entry[]) => [...entries]
  .sort((left, right) => codeUnitCompare(left.id, right.id));
export async function defineMechanismInput(value: unknown): Promise<MechanismInput> {
  const parsed = MechanismInputCandidateSchema.parse(value);
  const {
    mechanismInputDigest: claimedDigest, colliders: colliderCandidates,
    truthLevel: _claimedTruth, ...content
  } = parsed;
  const bodies = new Map(content.bodies.map((body) => [body.id, body]));
  const colliders: MechanismCollider[] = [];
  for (const candidate of colliderCandidates) {
    const identity = z.object({
      id: EntityIdSchema, bodyId: EntityIdSchema, sourceBodyId: EntityIdSchema,
    }).passthrough().parse(candidate);
    const body = bodies.get(identity.bodyId);
    if (!body) throw new Error(`Collider body is unknown: ${identity.bodyId}`);
    if (!body.sourceBodyIds.includes(identity.sourceBodyId)) {
      throw new Error(`Collider source body is not declared by mechanism body: ${identity.id}`);
    }
    colliders.push(await defineMechanismCollider(candidate, {
      bodyKind: body.kind, expectedBodyId: body.id,
      expectedSourceBodyId: identity.sourceBodyId,
    }));
  }
  const canonical = MechanismInputContentSchema.parse({
    ...content,
    truthLevel: "unverified-mechanism-input",
    bodies: byId(content.bodies.map((body) => ({ ...body, sourceBodyIds: [...body.sourceBodyIds].sort(codeUnitCompare) }))),
    colliders: byId(colliders), joints: byId(content.joints),
    pointForces: [...content.pointForces].sort((left, right) =>
      codeUnitCompare(canonicalJson(left), canonicalJson(right))),
    clearancePairs: byId(content.clearancePairs).map((pair) => {
      const [firstColliderId, secondColliderId] = canonicalPair(pair.firstColliderId, pair.secondColliderId);
      return { ...pair, firstColliderId, secondColliderId };
    }),
  });
  const mechanismInputDigest = await revisionId({ fixedStepHz: MECHANISM_STEP_HZ, ...canonical });
  if (claimedDigest !== undefined && claimedDigest !== mechanismInputDigest) {
    throw new Error("Mechanism input digest does not match canonical content");
  }
  return freezeSnapshot(MechanismInputSchema.parse({ ...canonical, mechanismInputDigest }));
}

export const MechanismFrameSchema = z.object({
  sourceRevision: RevisionSchema, studyId: EntityIdSchema, mechanismInputDigest: RevisionSchema,
  stepIndex: outputStepIndex,
  bodies: z.array(z.object({
    bodyId: EntityIdSchema, positionM: MechanismOutputVector3Schema, orientation: MechanismOutputQuaternionSchema,
    linearVelocityMps: MechanismOutputVector3Schema, angularVelocityRadS: MechanismOutputVector3Schema,
  }).strict()).min(1).max(MAX_BODIES),
  joints: z.array(z.discriminatedUnion("kind", [
    z.object({ jointId: EntityIdSchema, kind: z.literal("rigid") }).strict(),
    z.object({
      jointId: EntityIdSchema, kind: z.literal("revolute"),
      positionRad: canonicalFinite, velocityRadS: canonicalFinite,
    }).strict(),
    z.object({
      jointId: EntityIdSchema, kind: z.literal("prismatic"),
      positionM: canonicalFinite, velocityMps: canonicalFinite,
    }).strict(),
  ])).max(MAX_BODIES),
}).strict();
const colliderPair = { firstColliderId: EntityIdSchema, secondColliderId: EntityIdSchema };
export const ContactEventSchema = z.object({
  stepIndex: outputStepIndex, phase: z.enum(["begin", "persist", "end"]),
  ...colliderPair, pointM: MechanismOutputVector3Schema,
  // Unit direction in the world frame, pointing from firstColliderId toward secondColliderId.
  normalWorld: MechanismOutputVector3Schema.refine(
    (value) => Math.abs(Math.hypot(...value) - 1) <= MECHANISM_UNIT_TOLERANCE,
    "Mechanism contact normal must be unit",
  ),
  penetrationM: canonicalFinite.nonnegative(), normalForceN: canonicalFinite.nonnegative(),
}).strict();
export const ClearanceSampleSchema = z.object({
  stepIndex: outputStepIndex, pairId: EntityIdSchema,
  ...colliderPair, distanceM: canonicalFinite,
}).strict();
export const MechanismReplayEvidenceSchema = z.object({
  sourceRevision: RevisionSchema, studyId: EntityIdSchema, mechanismInputDigest: RevisionSchema,
  bodyIds: idList(MAX_BODIES), jointIds: idList(MAX_BODIES), colliderIds: idList(MAX_COLLIDERS),
  clearancePairIds: idList(MAX_COLLIDERS), frames: z.array(MechanismFrameSchema).min(1).max(MECHANISM_MAX_REPLAY_FRAMES),
  contacts: z.array(ContactEventSchema).max(MECHANISM_MAX_CONTACT_EVENTS),
  clearanceSamples: z.array(ClearanceSampleSchema).max(MECHANISM_MAX_CLEARANCE_SAMPLES),
}).strict();
/** Candidate evidence only; Task 3 privately issues the composed verified MechanismResult. */
export const MechanismWorkerResultEvidenceCandidateSchema = z.object({
  replayDigest: RevisionSchema, mechanismInputDigest: RevisionSchema,
  engineVersion: z.string().min(1), runtimeVersion: z.string().min(1),
  runtimeDigest: RevisionSchema, solverBuildDigest: RevisionSchema, wasmModuleDigest: RevisionSchema, settingsDigest: RevisionSchema,
  verification: z.object({
    initialLinearMomentumKgMps: MechanismOutputVector3Schema, finalLinearMomentumKgMps: MechanismOutputVector3Schema,
    initialAngularMomentumKgM2ps: MechanismOutputVector3Schema, finalAngularMomentumKgM2ps: MechanismOutputVector3Schema,
    energyChangeJ: canonicalFinite, gravityWorkJ: canonicalFinite, pointForceWorkJ: canonicalFinite,
    energyAccountingErrorJ: canonicalFinite, maximumJointErrorM: canonicalFinite.nonnegative(),
  }).strict(),
}).strict();

export type MechanismInput = DeepReadonly<z.infer<typeof MechanismInputSchema>>;
export type MechanismFrame = z.infer<typeof MechanismFrameSchema>;
export type ContactEvent = z.infer<typeof ContactEventSchema>;
export type ClearanceSample = z.infer<typeof ClearanceSampleSchema>;
type MechanismReplaySnapshot = DeepReadonly<z.infer<typeof MechanismReplayEvidenceSchema> & {
  encodingVersion: typeof MECHANISM_REPLAY_ENCODING_VERSION;
  fixedStepHz: typeof MECHANISM_STEP_HZ;
  maximumPenetrationM: number;
  minimumRequestedClearanceM: number | null;
  truthLevel: "unverified-replay";
  replayDigest: string;
}>;
export type MechanismReplay = MechanismReplaySnapshot & { readonly canonicalBytes: Uint8Array };
export type MechanismWorkerResultEvidenceCandidate = z.infer<typeof MechanismWorkerResultEvidenceCandidateSchema>;
