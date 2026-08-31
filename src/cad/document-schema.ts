import { z } from "zod";

import { defineRevisionedSnapshot, RevisionSchema, type DeepReadonly } from "../domain/snapshots";
import {
  addStudyIntegrityIssues,
  LegacyStudySchema,
  MaterialDefinitionSchema,
  StudySchema,
} from "../engineering/study-schema";
import {
  ActorSchema,
  addBaseIntegrityIssues,
  DisplayUnitsSchema,
  LegacyDocumentBaseShape,
  FrameSchema,
  normalizeBaseDocument,
  normalizeParameterValue,
  ParameterSchema,
  ParameterValueSchema,
} from "./document-base";
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

export { ActorSchema, FrameSchema, normalizeParameterValue, ParameterSchema, ParameterValueSchema } from "./document-base";
export { EntityIdSchema } from "./model-schema";

export const SemanticReferenceSchema = z.string().regex(
  /^(document|parameter|frame|sketch|feature|body|component|instance|mate|named-selection|material|study):[a-z][a-z0-9-]{0,79}$/,
  "Semantic reference must identify a document entity",
);

const V1MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(1),
  sourceRevision: RevisionSchema,
}).strict();
const V2MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(2),
  sourceRevision: RevisionSchema,
  sourceMigrationProvenance: V1MigrationProvenanceSchema.optional(),
}).strict();
const V3MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(3),
  sourceRevision: RevisionSchema,
  sourceMigrationProvenance: V2MigrationProvenanceSchema.optional(),
}).strict();

const legacyDocumentContentShape = {
  ...LegacyDocumentBaseShape,
  schemaVersion: z.literal(1),
};
const versionTwoDocumentContentShape = {
  ...LegacyDocumentBaseShape,
  schemaVersion: z.literal(2),
  migrationProvenance: V1MigrationProvenanceSchema.optional(),
  sketches: z.array(SketchSchema),
  features: z.array(FeatureSchema),
  bodies: z.array(BodySchema),
  components: z.array(ComponentSchema),
  instances: z.array(AssemblyInstanceSchema),
  mates: z.array(MateSchema),
  namedSelections: z.array(NamedSelectionSchema),
};
const versionThreeDocumentContentShape = {
  ...LegacyDocumentBaseShape,
  schemaVersion: z.literal(3),
  migrationProvenance: V2MigrationProvenanceSchema.optional(),
  sketches: z.array(SketchSchema),
  features: z.array(FeatureSchema),
  bodies: z.array(BodySchema),
  components: z.array(ComponentSchema),
  instances: z.array(AssemblyInstanceSchema),
  mates: z.array(MateSchema),
  namedSelections: z.array(NamedSelectionSchema),
  materials: z.array(MaterialDefinitionSchema),
  studies: z.array(LegacyStudySchema),
};
const documentContentShape = {
  ...LegacyDocumentBaseShape,
  schemaVersion: z.literal(4),
  migrationProvenance: V3MigrationProvenanceSchema.optional(),
  sketches: z.array(SketchSchema),
  features: z.array(FeatureSchema),
  bodies: z.array(BodySchema),
  components: z.array(ComponentSchema),
  instances: z.array(AssemblyInstanceSchema),
  mates: z.array(MateSchema),
  namedSelections: z.array(NamedSelectionSchema),
  materials: z.array(MaterialDefinitionSchema),
  studies: z.array(StudySchema),
};

type VersionTwoDocumentContent = z.infer<z.ZodObject<typeof versionTwoDocumentContentShape>>;
type VersionTwoDocument = DeepReadonly<VersionTwoDocumentContent & { revision: string }>;
type VersionThreeDocumentContent = z.infer<z.ZodObject<typeof versionThreeDocumentContentShape>>;
type VersionThreeDocument = DeepReadonly<VersionThreeDocumentContent & { revision: string }>;
type DocumentContent = z.infer<z.ZodObject<typeof documentContentShape>>;
type ModelIntegrityDocument = Pick<VersionTwoDocumentContent,
  "frames" | "parameters" | "sketches" | "features" | "bodies" | "components" | "instances" | "mates" | "namedSelections">;

function addModelDocumentIntegrityIssues(value: ModelIntegrityDocument, context: z.RefinementCtx): void {
  addBaseIntegrityIssues(value, context);
  addModelIntegrityIssues(value, context);
}

function addVersionTwoIntegrityIssues(value: VersionTwoDocumentContent, context: z.RefinementCtx): void {
  addModelDocumentIntegrityIssues(value, context);
}

function addDocumentIntegrityIssues(value: DocumentContent, context: z.RefinementCtx): void {
  addModelDocumentIntegrityIssues(value, context);
  addStudyIntegrityIssues(value, context);
}

function addVersionThreeDocumentIntegrityIssues(
  value: VersionThreeDocumentContent,
  context: z.RefinementCtx,
): void {
  addModelDocumentIntegrityIssues(value, context);
  addStudyIntegrityIssues(value as unknown as Parameters<typeof addStudyIntegrityIssues>[0], context);
}

const LegacyDesignDocumentContentSchema = z
  .object(legacyDocumentContentShape)
  .strict()
  .superRefine(addBaseIntegrityIssues);
const VersionTwoDesignDocumentContentSchema = z
  .object(versionTwoDocumentContentShape)
  .strict()
  .superRefine(addVersionTwoIntegrityIssues);
const VersionThreeDesignDocumentContentSchema = z
  .object(versionThreeDocumentContentShape)
  .strict()
  .superRefine(addVersionThreeDocumentIntegrityIssues);
export const DesignDocumentContentSchema = z
  .object(documentContentShape)
  .strict()
  .superRefine(addDocumentIntegrityIssues);
export const DesignDocumentSchema = z
  .object({ ...documentContentShape, revision: RevisionSchema })
  .strict()
  .superRefine(addDocumentIntegrityIssues);

export type DesignDocument = DeepReadonly<z.infer<typeof DesignDocumentSchema>>;

async function migrateVersionTwoDocument(value: VersionTwoDocument): Promise<VersionThreeDocument> {
  const {
    revision: sourceRevision,
    migrationProvenance: sourceMigrationProvenance,
    ...content
  } = value;
  return defineRevisionedSnapshot(VersionThreeDesignDocumentContentSchema, {
    ...content,
    schemaVersion: 3,
    migrationProvenance: {
      sourceSchemaVersion: 2,
      sourceRevision,
      ...(sourceMigrationProvenance === undefined ? {} : { sourceMigrationProvenance }),
    },
    materials: [],
    studies: [],
  }, normalizeBaseDocument);
}

async function migrateVersionThreeDocument(value: VersionThreeDocument): Promise<DesignDocument> {
  const { revision: sourceRevision, migrationProvenance: sourceMigrationProvenance, ...content } = value;
  return defineRevisionedSnapshot(DesignDocumentContentSchema, {
    ...content,
    schemaVersion: 4,
    migrationProvenance: {
      sourceSchemaVersion: 3,
      sourceRevision,
      ...(sourceMigrationProvenance === undefined ? {} : { sourceMigrationProvenance }),
    },
    studies: content.studies.map((study) => study.kind === "topology"
      ? { ...study, configurationState: "requires-configuration" as const }
      : study),
  }, normalizeBaseDocument);
}

export async function defineDesignDocument(value: unknown): Promise<DesignDocument> {
  const version = z.object({ schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) })
    .passthrough()
    .parse(value).schemaVersion;
  if (version === 4) {
    return defineRevisionedSnapshot(DesignDocumentContentSchema, value, normalizeBaseDocument);
  }
  if (version === 3) {
    const document = await defineRevisionedSnapshot(
      VersionThreeDesignDocumentContentSchema, value, normalizeBaseDocument,
    );
    return migrateVersionThreeDocument(document);
  }
  if (version === 2) {
    const document = await defineRevisionedSnapshot(
      VersionTwoDesignDocumentContentSchema,
      value,
      normalizeBaseDocument,
    );
    return migrateVersionThreeDocument(await migrateVersionTwoDocument(document));
  }

  const legacy = await defineRevisionedSnapshot(
    LegacyDesignDocumentContentSchema,
    value,
    normalizeBaseDocument,
  );
  const { revision: sourceRevision, ...content } = legacy;
  const versionTwo = await defineRevisionedSnapshot(VersionTwoDesignDocumentContentSchema, {
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
  return migrateVersionThreeDocument(await migrateVersionTwoDocument(versionTwo));
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
    schemaVersion: 4,
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
    materials: [],
    studies: [],
  });
}
