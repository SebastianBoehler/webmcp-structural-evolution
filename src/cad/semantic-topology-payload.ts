import { z } from "zod";

const finite = z.number().finite();
const id = z.string().min(1);
const vec3 = z.tuple([finite, finite, finite]);

export const TopologySignaturePayloadSchema = z.object({
  ownerFeatureId: id,
  kind: z.enum(["face", "edge"]),
  geometry: z.enum(["plane", "cylinder", "cone", "sphere", "curve", "other"]),
  centroidM: vec3,
  measureSI: finite.nonnegative(),
  adjacentKinds: z.array(z.string()),
}).strict();

export const SemanticTopologySchema = z.object({
  id,
  bodyId: id,
  signature: TopologySignaturePayloadSchema,
  surfaceEvidence: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("plane"), normal: vec3 }).strict(),
    z.object({
      kind: z.literal("cylinder"),
      axis: vec3,
      originM: vec3,
      radiusM: finite.positive(),
    }).strict(),
  ]).optional(),
}).strict().superRefine((topology, context) => {
  const evidence = topology.surfaceEvidence;
  const exactSurface = topology.signature.kind === "face"
    && (topology.signature.geometry === "plane" || topology.signature.geometry === "cylinder");
  if (exactSurface && evidence?.kind !== topology.signature.geometry) {
    context.addIssue({
      code: "custom",
      message: "Planar and cylindrical faces require matching exact surface evidence",
    });
    return;
  }
  if (!exactSurface && evidence) {
    context.addIssue({
      code: "custom",
      message: "Exact surface evidence does not match semantic face geometry",
    });
    return;
  }
  if (!evidence) return;
  const direction = evidence.kind === "plane" ? evidence.normal : evidence.axis;
  const scale = Math.max(...direction.map(Math.abs));
  const magnitude = scale > 0
    ? Math.hypot(...direction.map((value) => value / scale)) * scale
    : 0;
  if (!Number.isFinite(magnitude) || Math.abs(magnitude - 1) > 1e-9) {
    context.addIssue({ code: "custom", message: "Exact surface direction must be unit length" });
  }
});

export type SemanticTopology = z.infer<typeof SemanticTopologySchema>;
