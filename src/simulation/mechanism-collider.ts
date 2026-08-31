import { z } from "zod";

import { EntityIdSchema } from "../cad/model-schema";
import { revisionId } from "../domain/revisions";
import { freezeSnapshot, RevisionSchema, type DeepReadonly } from "../domain/snapshots";
import {
  codeUnitCompare, finite, MechanismInputTransformSchema, MechanismVector3Schema,
} from "./mechanism-math";

const MAX_EXTENT_M = 1_000;
const MAX_HULL_VERTICES = 256;
const MAX_TRIMESH_VERTICES = 4_096;
const MAX_TRIMESH_TRIANGLES = 8_192;
const positiveExtent = finite.positive().max(MAX_EXTENT_M);
const boundedPoint = MechanismVector3Schema.refine(
  (point) => point.every((value) => Math.abs(value) <= MAX_EXTENT_M),
  "Collider point exceeds the supported extent",
);
const uint32 = z.number().int().min(0).max(0xffff_ffff).overwrite((value) => Object.is(value, -0) ? 0 : value);
const triangleIndex = z.number().int().nonnegative().overwrite((value) => Object.is(value, -0) ? 0 : value);

const PrimitiveShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("box"), halfExtentsM: z.tuple([positiveExtent, positiveExtent, positiveExtent]) }).strict(),
  z.object({ kind: z.literal("sphere"), radiusM: positiveExtent }).strict(),
  z.object({ kind: z.literal("capsule"), halfHeightM: positiveExtent, radiusM: positiveExtent }).strict(),
  z.object({ kind: z.literal("cylinder"), halfHeightM: positiveExtent, radiusM: positiveExtent }).strict(),
]);
const ConvexHullShapeSchema = z.object({
  kind: z.literal("convex-hull"),
  verticesM: z.array(boundedPoint).min(4).max(MAX_HULL_VERTICES),
}).strict().superRefine((shape, context) => {
  const [origin, ...points] = shape.verticesM;
  const first = points.find((point) => Math.hypot(
    point[0] - origin![0], point[1] - origin![1], point[2] - origin![2],
  ) > 1e-12);
  if (!first) return context.addIssue({ code: "custom", message: "Convex hull vertices must span a volume" });
  const axis = [first[0] - origin![0], first[1] - origin![1], first[2] - origin![2]] as const;
  const second = points.find((point) => {
    const offset = [point[0] - origin![0], point[1] - origin![1], point[2] - origin![2]] as const;
    return Math.hypot(
      axis[1] * offset[2] - axis[2] * offset[1],
      axis[2] * offset[0] - axis[0] * offset[2],
      axis[0] * offset[1] - axis[1] * offset[0],
    ) > 1e-12;
  });
  if (!second) return context.addIssue({ code: "custom", message: "Convex hull vertices must span a volume" });
  const offset = [second[0] - origin![0], second[1] - origin![1], second[2] - origin![2]] as const;
  const normal = [
    axis[1] * offset[2] - axis[2] * offset[1],
    axis[2] * offset[0] - axis[0] * offset[2],
    axis[0] * offset[1] - axis[1] * offset[0],
  ] as const;
  if (!points.some((point) => Math.abs(
    normal[0] * (point[0] - origin![0]) + normal[1] * (point[1] - origin![1])
      + normal[2] * (point[2] - origin![2]),
  ) > 1e-12)) context.addIssue({ code: "custom", message: "Convex hull vertices must span a volume" });
});
const FixedTrimeshShapeSchema = z.object({
  kind: z.literal("fixed-trimesh"),
  verticesM: z.array(boundedPoint).min(3).max(MAX_TRIMESH_VERTICES),
  triangles: z.array(z.tuple([triangleIndex, triangleIndex, triangleIndex]))
    .min(1).max(MAX_TRIMESH_TRIANGLES),
}).strict().superRefine((shape, context) => {
  for (const [index, triangle] of shape.triangles.entries()) {
    if (new Set(triangle).size !== 3 || triangle.some((vertex) => vertex >= shape.verticesM.length)) {
      context.addIssue({ code: "custom", path: ["triangles", index], message: "Collider triangle indices are invalid" });
      continue;
    }
    const [a, b, c] = triangle.map((vertex) => shape.verticesM[vertex]!);
    const ab = [b![0] - a![0], b![1] - a![1], b![2] - a![2]] as const;
    const ac = [c![0] - a![0], c![1] - a![1], c![2] - a![2]] as const;
    if (Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0],
    ) <= 1e-12) context.addIssue({ code: "custom", path: ["triangles", index], message: "Collider triangle must have nonzero geometric area" });
  }
});
const ShapeSchema = z.union([PrimitiveShapeSchema, ConvexHullShapeSchema, FixedTrimeshShapeSchema]);
const ApproximationSchema = z.object({
  kind: z.enum(["exact-primitive", "convex-hull", "fixed-trimesh"]),
  maximumSurfaceDeviationM: finite.nonnegative().max(MAX_EXTENT_M),
}).strict();

const ColliderCandidateSchema = z.object({
  id: EntityIdSchema, bodyId: EntityIdSchema, sourceBodyId: EntityIdSchema,
  sourceArtifactIds: z.array(RevisionSchema).min(1).max(32)
    .refine((ids) => new Set(ids).size === ids.length, "Collider source artifact IDs must be unique"),
  bodyLocalTransform: MechanismInputTransformSchema,
  approximation: ApproximationSchema,
  shape: ShapeSchema,
  geometryDigest: RevisionSchema.optional(),
  truthLevel: z.literal("unverified-collider-input").optional(),
  membershipMask: uint32.positive(), filterMask: uint32,
}).strict().superRefine((collider, context) => {
  const matching = collider.approximation.kind === "exact-primitive"
    ? ["box", "sphere", "capsule", "cylinder"].includes(collider.shape.kind)
    : collider.approximation.kind === collider.shape.kind;
  if (!matching) context.addIssue({ code: "custom", message: "Collider approximation kind does not match its shape" });
  if (collider.approximation.kind === "exact-primitive"
    && collider.approximation.maximumSurfaceDeviationM !== 0) {
    context.addIssue({ code: "custom", message: "Exact primitive collider deviation must be zero metres" });
  }
});

/** Canonical, self-contained geometry only. Task 2 must verify its exact-CAD lineage before solver use. */
export type MechanismCollider = DeepReadonly<
  Omit<z.infer<typeof ColliderCandidateSchema>, "geometryDigest" | "truthLevel"> & {
    geometryDigest: string; truthLevel: "unverified-collider-input";
  }
>;

const canonicalUnverifiedColliders = new WeakSet<object>();
export const MechanismColliderSchema = z.custom<MechanismCollider>((value) =>
  value !== null && typeof value === "object" && canonicalUnverifiedColliders.has(value),
  "Expected canonical unverified mechanism collider input",
);

export async function defineMechanismCollider(
  value: unknown,
  binding: Readonly<{
    bodyKind: "fixed" | "dynamic";
    expectedBodyId?: string; expectedSourceBodyId?: string;
  }>,
): Promise<MechanismCollider> {
  const collider = ColliderCandidateSchema.parse(value);
  if (binding.expectedBodyId !== undefined && collider.bodyId !== binding.expectedBodyId) {
    throw new Error("Collider body does not match its input body binding");
  }
  if (binding.expectedSourceBodyId !== undefined && collider.sourceBodyId !== binding.expectedSourceBodyId) {
    throw new Error("Collider source body does not match its design body binding");
  }
  if (binding.bodyKind === "dynamic" && collider.shape.kind === "fixed-trimesh") {
    throw new Error("Dynamic mechanism bodies cannot use fixed trimesh colliders");
  }
  const payload = {
    bodyLocalTransform: collider.bodyLocalTransform,
    approximation: collider.approximation,
    shape: collider.shape,
  };
  const geometryDigest = await revisionId(payload);
  if (collider.geometryDigest !== undefined && collider.geometryDigest !== geometryDigest) {
    throw new Error("Collider geometry digest does not match canonical geometry");
  }
  const { geometryDigest: _claimed, truthLevel: _truth, ...content } = collider;
  const canonical = freezeSnapshot({
    ...content,
    sourceArtifactIds: [...content.sourceArtifactIds].sort(codeUnitCompare),
    geometryDigest,
    truthLevel: "unverified-collider-input" as const,
  });
  canonicalUnverifiedColliders.add(canonical);
  return canonical;
}
