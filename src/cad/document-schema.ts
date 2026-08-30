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
import {
  addModelIntegrityIssues,
  AssemblyInstanceSchema,
  BodySchema,
  ComponentSchema,
  EntityIdSchema,
  FeatureSchema,
  MateSchema,
  NamedSelectionSchema,
  SketchSchema,
} from "./model-schema";

const finite = z.number().finite();
export { EntityIdSchema } from "./model-schema";
export const SemanticReferenceSchema = z.string().regex(
  /^(document|parameter|frame|sketch|feature|body|component|instance|mate|named-selection):[a-z][a-z0-9-]{0,79}$/,
  "Semantic reference must identify a document entity",
);

const DisplayUnitsSchema = z.object({
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

const legacyDocumentContentShape = {
  id: EntityIdSchema,
  label: z.string().min(1),
  schemaVersion: z.literal(1),
  units: DisplayUnitsSchema,
  createdBy: ActorSchema,
  frames: z.array(FrameSchema),
  parameters: z.array(ParameterSchema),
};
const MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(1),
  sourceRevision: RevisionSchema,
}).strict();
const documentContentShape = {
  ...legacyDocumentContentShape,
  schemaVersion: z.literal(2),
  migrationProvenance: MigrationProvenanceSchema.optional(),
  sketches: z.array(SketchSchema),
  features: z.array(FeatureSchema),
  bodies: z.array(BodySchema),
  components: z.array(ComponentSchema),
  instances: z.array(AssemblyInstanceSchema),
  mates: z.array(MateSchema),
  namedSelections: z.array(NamedSelectionSchema),
};

type DocumentContent = z.infer<z.ZodObject<typeof documentContentShape>>;
type LegacyDocumentContent = z.infer<z.ZodObject<typeof legacyDocumentContentShape>>;
type BaseDocumentContent = Pick<LegacyDocumentContent, "frames" | "parameters">;

function addBaseIntegrityIssues(value: BaseDocumentContent, context: z.RefinementCtx): void {
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

function addDocumentIntegrityIssues(value: DocumentContent, context: z.RefinementCtx): void {
  addBaseIntegrityIssues(value, context);
  addModelIntegrityIssues(value, context);
}

const LegacyDesignDocumentContentSchema = z
  .object(legacyDocumentContentShape)
  .strict()
  .superRefine(addBaseIntegrityIssues);

export const DesignDocumentContentSchema = z
  .object(documentContentShape)
  .strict()
  .superRefine(addDocumentIntegrityIssues);
export const DesignDocumentSchema = z
  .object({ ...documentContentShape, revision: RevisionSchema })
  .strict()
  .superRefine(addDocumentIntegrityIssues);

export type DesignDocument = DeepReadonly<z.infer<typeof DesignDocumentSchema>>;

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

function normalizeBaseDocument<Content extends BaseDocumentContent>(value: Content): Content {
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

export async function defineDesignDocument(value: unknown): Promise<DesignDocument> {
  const version = z.object({ schemaVersion: z.union([z.literal(1), z.literal(2)]) })
    .passthrough()
    .parse(value).schemaVersion;
  if (version === 2) {
    return defineRevisionedSnapshot(DesignDocumentContentSchema, value, normalizeBaseDocument);
  }

  const legacy = await defineRevisionedSnapshot(
    LegacyDesignDocumentContentSchema,
    value,
    normalizeBaseDocument,
  );
  const { revision: sourceRevision, ...content } = legacy;
  return defineRevisionedSnapshot(DesignDocumentContentSchema, {
    ...content,
    schemaVersion: 2,
    migrationProvenance: { sourceSchemaVersion: 1, sourceRevision },
    sketches: [],
    features: [],
    bodies: [],
    components: [],
    instances: [],
    mates: [],
    namedSelections: [],
  }, normalizeBaseDocument);
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
    schemaVersion: 2,
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
    sketches: [],
    features: [],
    bodies: [],
    components: [],
    instances: [],
    mates: [],
    namedSelections: [],
  });
}
