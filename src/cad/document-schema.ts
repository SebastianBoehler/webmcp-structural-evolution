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
import {
  defineRevisionedSnapshot,
  RevisionSchema,
  type DeepReadonly,
} from "../domain/snapshots";

const finite = z.number().finite();
const entityIdPattern = /^[a-z][a-z0-9-]{0,79}$/;

export const EntityIdSchema = z.string().regex(
  entityIdPattern,
  "Entity ID must be lowercase kebab-case",
);
export const SemanticReferenceSchema = z.string().regex(
  /^(document|parameter|frame):[a-z][a-z0-9-]{0,79}$/,
  "Semantic reference must identify a document, parameter, or frame",
);

const DisplayUnitsSchema = z.object({
  length: LengthUnitSchema,
  angle: z.enum(["deg", "rad"]),
  mass: z.enum(["g", "kg"]),
}).strict();
const ActorSchema = z.object({
  kind: z.enum(["human", "agent"]),
  id: EntityIdSchema,
}).strict();
const FrameSchema = z.object({
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
const ParameterSchema = z.object({
  id: EntityIdSchema,
  label: z.string().min(1),
  value: ParameterValueSchema,
}).strict();

const documentContentShape = {
  id: EntityIdSchema,
  label: z.string().min(1),
  schemaVersion: z.literal(1),
  units: DisplayUnitsSchema,
  createdBy: ActorSchema,
  frames: z.array(FrameSchema),
  parameters: z.array(ParameterSchema),
};

type DocumentContent = z.infer<z.ZodObject<typeof documentContentShape>>;

function addDocumentIntegrityIssues(value: DocumentContent, context: z.RefinementCtx): void {
  const frameIds = new Set<string>();
  for (const frame of value.frames) {
    if (frameIds.has(frame.id)) {
      context.addIssue({ code: "custom", message: `Duplicate frame ID: ${frame.id}` });
    }
    frameIds.add(frame.id);
  }

  const parameterIds = new Set<string>();
  for (const parameter of value.parameters) {
    if (parameterIds.has(parameter.id)) {
      context.addIssue({ code: "custom", message: `Duplicate parameter ID: ${parameter.id}` });
    }
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

export const DesignDocumentContentSchema = z
  .object(documentContentShape)
  .strict()
  .superRefine(addDocumentIntegrityIssues);
export const DesignDocumentSchema = z
  .object({ ...documentContentShape, revision: RevisionSchema })
  .strict()
  .superRefine(addDocumentIntegrityIssues);

export type DesignDocument = DeepReadonly<z.infer<typeof DesignDocumentSchema>>;

function normalizeParameterValue(value: z.infer<typeof ParameterValueSchema>) {
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

function normalizeDocument(value: DocumentContent): DocumentContent {
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
  };
}

export async function defineDesignDocument(value: unknown): Promise<DesignDocument> {
  return defineRevisionedSnapshot(DesignDocumentContentSchema, value, normalizeDocument);
}

const CreateDesignDocumentInputSchema = z.object({
  id: EntityIdSchema,
  label: z.string().min(1),
  units: DisplayUnitsSchema,
  createdBy: ActorSchema,
}).strict();

export async function createDesignDocument(input: unknown): Promise<DesignDocument> {
  const value = CreateDesignDocumentInputSchema.parse(input);
  return defineDesignDocument({
    ...value,
    schemaVersion: 1,
    frames: [{
      id: "world",
      label: "World",
      transform: {
        position: {
          x: { value: 0, unit: "m" },
          y: { value: 0, unit: "m" },
          z: { value: 0, unit: "m" },
        },
        orientation: {
          roll: { value: 0, unit: "rad" },
          pitch: { value: 0, unit: "rad" },
          yaw: { value: 0, unit: "rad" },
        },
      },
    }],
    parameters: [],
  });
}
