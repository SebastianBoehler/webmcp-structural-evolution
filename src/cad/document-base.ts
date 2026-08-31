import { z } from "zod";

import {
  AngleSchema,
  LengthSchema,
  LengthUnitSchema,
  MassSchema,
  normalizeAngle,
  normalizeLength,
  normalizeMass,
  normalizeTransform,
  TransformSchema,
} from "../domain/engineering-units";
import { EntityIdSchema } from "./model-schema";

const finite = z.number().finite();

export const DisplayUnitsSchema = z.object({
  length: LengthUnitSchema,
  angle: z.enum(["deg", "rad"]),
  mass: z.enum(["g", "kg"]),
}).strict();
export const ActorSchema = z.object({
  kind: z.enum(["human", "agent"]),
  id: EntityIdSchema,
}).strict();
export const FrameSchema = z.object({
  id: EntityIdSchema,
  label: z.string().min(1),
  parentId: EntityIdSchema.optional(),
  transform: TransformSchema,
}).strict();
export const ParameterValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dimensionless"), value: finite }).strict(),
  z.object({ kind: z.literal("length"), value: LengthSchema }).strict(),
  z.object({ kind: z.literal("angle"), value: AngleSchema }).strict(),
  z.object({ kind: z.literal("mass"), value: MassSchema }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("text"), value: z.string() }).strict(),
]);
export const ParameterSchema = z.object({
  id: EntityIdSchema,
  label: z.string().min(1),
  value: ParameterValueSchema,
}).strict();

export const LegacyDocumentBaseShape = {
  id: EntityIdSchema,
  label: z.string().min(1),
  units: DisplayUnitsSchema,
  createdBy: ActorSchema,
  frames: z.array(FrameSchema),
  parameters: z.array(ParameterSchema),
};

export type BaseDocumentContent = Readonly<{
  frames: readonly z.infer<typeof FrameSchema>[];
  parameters: readonly z.infer<typeof ParameterSchema>[];
}>;

export function normalizeParameterValue(value: z.infer<typeof ParameterValueSchema>) {
  switch (value.kind) {
    case "length":
      return { ...value, value: normalizeLength(value.value) };
    case "angle":
      return { ...value, value: normalizeAngle(value.value) };
    case "mass":
      return { ...value, value: normalizeMass(value.value) };
    default:
      return value;
  }
}

export function normalizeBaseDocument<Content extends BaseDocumentContent>(value: Content): Content {
  return {
    ...value,
    frames: value.frames.map((frame) => ({
      ...frame,
      transform: normalizeTransform(frame.transform),
    })),
    parameters: value.parameters.map((parameter) => ({
      ...parameter,
      value: normalizeParameterValue(parameter.value),
    })),
  } as Content;
}

export function addBaseIntegrityIssues(value: BaseDocumentContent, context: z.RefinementCtx): void {
  const frameIds = new Set<string>();
  for (const frame of value.frames) {
    if (frameIds.has(frame.id)) context.addIssue({ code: "custom", message: `Duplicate frame ID: ${frame.id}` });
    frameIds.add(frame.id);
  }

  const parameterIds = new Set<string>();
  for (const parameter of value.parameters) {
    if (parameterIds.has(parameter.id)) context.addIssue({ code: "custom", message: `Duplicate parameter ID: ${parameter.id}` });
    parameterIds.add(parameter.id);
  }

  const roots = value.frames.filter((frame) => frame.parentId === undefined);
  if (roots.length !== 1 || roots[0]?.id !== "world") {
    context.addIssue({ code: "custom", message: "Document must have exactly one root frame named world" });
  }
  for (const frame of value.frames) {
    if (frame.parentId !== undefined && !frameIds.has(frame.parentId)) {
      context.addIssue({ code: "custom", message: `Frame parent is unresolved: ${frame.parentId}` });
    }
  }

  const parents = new Map(value.frames.map((frame) => [frame.id, frame.parentId]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      context.addIssue({ code: "custom", message: `Frame parents are cyclic at: ${id}` });
      return;
    }
    visiting.add(id);
    const parentId = parents.get(id);
    if (parentId !== undefined && parents.has(parentId)) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const frame of value.frames) visit(frame.id);
}
