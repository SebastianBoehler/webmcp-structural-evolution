import { z } from "zod";

import {
  LengthUnitSchema,
  LengthVectorSchema,
  normalizeLengthVector,
  normalizeOrientation,
  normalizePositiveLength,
  normalizePositiveLengthVector,
  normalizeTransform,
  OrientationSchema,
  PositiveLengthSchema,
  PositiveLengthVectorSchema,
  TransformSchema,
} from "./engineering-units";
import type { DeepReadonly } from "./snapshots";

export const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/, "Digest must be a lowercase SHA-256 digest");
export const CadMediaTypeSchema = z.enum([
  "model/gltf-binary", "model/gltf+json", "model/obj", "model/stl", "model/3mf", "model/step",
]);

const GraphBoxSchema = z.object({
  kind: z.literal("box"), id: z.string().min(1), center: LengthVectorSchema, size: PositiveLengthVectorSchema,
}).strict();
const GraphCylinderSchema = z.object({
  kind: z.literal("cylinder"), id: z.string().min(1), center: LengthVectorSchema,
  radius: PositiveLengthSchema, height: PositiveLengthSchema, orientation: OrientationSchema,
}).strict();
const GraphTransformSchema = z.object({
  kind: z.literal("transform"), id: z.string().min(1), source: z.string().min(1), transform: TransformSchema,
}).strict();
const graphBinaryOperation = (kind: "union" | "intersection" | "subtraction") => z.object({
  kind: z.literal(kind), id: z.string().min(1), left: z.string().min(1), right: z.string().min(1),
}).strict();
const GraphNamedInterfaceSchema = z.object({
  kind: z.literal("named-interface"), id: z.string().min(1), source: z.string().min(1),
}).strict();

const GraphNodeSchema = z.discriminatedUnion("kind", [
  GraphBoxSchema, GraphCylinderSchema, GraphTransformSchema,
  graphBinaryOperation("union"), graphBinaryOperation("intersection"),
  graphBinaryOperation("subtraction"), GraphNamedInterfaceSchema,
]);
type MutableGraphNode = z.infer<typeof GraphNodeSchema>;

export function graphReferences(node: MutableGraphNode): readonly string[] {
  switch (node.kind) {
    case "transform":
    case "named-interface": return [node.source];
    case "union":
    case "intersection":
    case "subtraction": return [node.left, node.right];
    default: return [];
  }
}

function validateGraph(nodes: readonly MutableGraphNode[], context: z.RefinementCtx) {
  const byId = new Map<string, MutableGraphNode>();
  nodes.forEach((node, index) => {
    if (byId.has(node.id)) context.addIssue({ code: "custom", message: `Duplicate parametric node ID: ${node.id}`, path: ["nodes", index, "id"] });
    byId.set(node.id, node);
  });
  const consumers = new Set<string>();
  nodes.forEach((node, index) => graphReferences(node).forEach((reference) => {
    consumers.add(reference);
    if (!byId.has(reference)) context.addIssue({ code: "custom", message: `Missing parametric node: ${reference}`, path: ["nodes", index] });
  }));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      context.addIssue({ code: "custom", message: `Parametric graph contains a cycle at ${id}`, path: ["nodes"] });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = byId.get(id);
    if (node) graphReferences(node).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  byId.forEach((_, id) => visit(id));
  const roots = nodes.filter((node) => node.kind !== "named-interface" && !consumers.has(node.id));
  if (roots.length !== 1) context.addIssue({ code: "custom", message: "Parametric graph must have exactly one bounded solid root", path: ["nodes"] });
}

export const ParametricGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema).min(1).max(256, "Parametric graph exceeds 256 operations"),
})
  .strict()
  .superRefine((graph, context) => validateGraph(graph.nodes, context));
export type ParametricGraph = DeepReadonly<z.infer<typeof ParametricGraphSchema>>;

export const ComponentGeometrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), assetId: DigestSchema, mediaType: CadMediaTypeSchema, units: LengthUnitSchema }).strict(),
  z.object({ kind: z.literal("parametric"), graph: ParametricGraphSchema }).strict(),
]);

export function normalizeComponentGeometry(value: z.infer<typeof ComponentGeometrySchema>) {
  return value.kind === "asset" ? value : { ...value, graph: { nodes: value.graph.nodes.map((node) => {
    if (node.kind === "box") return { ...node, center: normalizeLengthVector(node.center), size: normalizePositiveLengthVector(node.size) };
    if (node.kind === "cylinder") return { ...node, center: normalizeLengthVector(node.center), radius: normalizePositiveLength(node.radius), height: normalizePositiveLength(node.height), orientation: normalizeOrientation(node.orientation) };
    if (node.kind === "transform") return { ...node, transform: normalizeTransform(node.transform) };
    return node;
  }) } };
}
