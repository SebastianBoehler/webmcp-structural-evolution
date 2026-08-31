import { z } from "zod";

import { defineRevisionedSnapshot, RevisionSchema, type DeepReadonly } from "../domain/snapshots";
import {
  addStudyIntegrityIssues,
  LegacyStudySchema,
  MaterialDefinitionSchema,
  StudySchema,
  VersionFourStudySchema,
} from "../engineering/study-schema";
import {
  ActorSchema,
  addBaseIntegrityIssues,
  LegacyDocumentBaseShape,
  FrameSchema,
  normalizeBaseDocument,
  normalizeParameterValue,
  ParameterSchema,
  ParameterValueSchema,
} from "./document-base";
import { CreateDesignDocumentInputSchema, initialDocumentContent } from "./document-create";
import {
  addModelIntegrityIssues,
  AssemblyInstanceSchema,
  BodySchema,
  ComponentSchema,
  EntityIdSchema,
  FeatureSchema,
  LegacyMateSchema,
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
const V4MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(4), sourceRevision: RevisionSchema,
  sourceMigrationProvenance: V3MigrationProvenanceSchema.optional(),
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
  mates: z.array(LegacyMateSchema),
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
  mates: z.array(LegacyMateSchema),
  namedSelections: z.array(NamedSelectionSchema),
  materials: z.array(MaterialDefinitionSchema),
  studies: z.array(LegacyStudySchema),
};
const versionFourDocumentContentShape = {
  ...LegacyDocumentBaseShape,
  schemaVersion: z.literal(4),
  migrationProvenance: V3MigrationProvenanceSchema.optional(),
  sketches: z.array(SketchSchema),
  features: z.array(FeatureSchema),
  bodies: z.array(BodySchema),
  components: z.array(ComponentSchema),
  instances: z.array(AssemblyInstanceSchema),
  mates: z.array(LegacyMateSchema),
  namedSelections: z.array(NamedSelectionSchema),
  materials: z.array(MaterialDefinitionSchema),
  studies: z.array(VersionFourStudySchema),
};
const documentContentShape = {
  ...versionFourDocumentContentShape,
  schemaVersion: z.literal(5),
  migrationProvenance: V4MigrationProvenanceSchema.optional(),
  mates: z.array(MateSchema),
  studies: z.array(StudySchema),
};

type VersionTwoDocumentContent = z.infer<z.ZodObject<typeof versionTwoDocumentContentShape>>;
type VersionTwoDocument = DeepReadonly<VersionTwoDocumentContent & { revision: string }>;
type VersionThreeDocumentContent = z.infer<z.ZodObject<typeof versionThreeDocumentContentShape>>;
type VersionThreeDocument = DeepReadonly<VersionThreeDocumentContent & { revision: string }>;
type VersionFourDocumentContent = z.infer<z.ZodObject<typeof versionFourDocumentContentShape>>;
type VersionFourDocument = DeepReadonly<VersionFourDocumentContent & { revision: string }>;
type DocumentContent = z.infer<z.ZodObject<typeof documentContentShape>>;
type ModelIntegrityDocument = Pick<VersionTwoDocumentContent,
  "frames" | "parameters" | "sketches" | "features" | "bodies" | "components" | "instances" | "namedSelections">
  & { mates: readonly z.infer<typeof MateSchema>[] };

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
const VersionFourDesignDocumentContentSchema = z.object(versionFourDocumentContentShape).strict()
  .superRefine((value, context) => {
    addModelDocumentIntegrityIssues(value, context);
    addStudyIntegrityIssues(value as unknown as Parameters<typeof addStudyIntegrityIssues>[0], context);
  });
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

async function migrateVersionThreeDocument(value: VersionThreeDocument): Promise<VersionFourDocument> {
  const { revision: sourceRevision, migrationProvenance: sourceMigrationProvenance, ...content } = value;
  return defineRevisionedSnapshot(VersionFourDesignDocumentContentSchema, {
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

async function migrateVersionFourDocument(value: VersionFourDocument): Promise<DesignDocument> {
  for (const study of value.studies) if (study.kind === "mechanism") {
    if (study.instanceIds.length > 256) {
      throw new Error(`Legacy mechanism study exceeds the v5 instance budget: ${study.id}`);
    }
    if (study.mateIds.length > 256) throw new Error(`Legacy mechanism study exceeds the v5 mate budget: ${study.id}`);
  }
  const { revision: sourceRevision, migrationProvenance: sourceMigrationProvenance, ...content } = value;
  return defineRevisionedSnapshot(DesignDocumentContentSchema, {
    ...content, schemaVersion: 5,
    migrationProvenance: {
      sourceSchemaVersion: 4, sourceRevision,
      ...(sourceMigrationProvenance === undefined ? {} : { sourceMigrationProvenance }),
    },
    studies: content.studies.map((study) => study.kind === "mechanism"
      ? { ...study, configurationState: "requires-configuration" as const }
      : study),
  }, normalizeBaseDocument);
}

export async function defineDesignDocument(value: unknown): Promise<DesignDocument> {
  const version = z.object({ schemaVersion: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
  ]) })
    .passthrough()
    .parse(value).schemaVersion;
  if (version === 5) {
    return defineRevisionedSnapshot(DesignDocumentContentSchema, value, normalizeBaseDocument);
  }
  if (version === 4) {
    const document = await defineRevisionedSnapshot(VersionFourDesignDocumentContentSchema, value, normalizeBaseDocument);
    return migrateVersionFourDocument(document);
  }
  if (version === 3) {
    const document = await defineRevisionedSnapshot(
      VersionThreeDesignDocumentContentSchema, value, normalizeBaseDocument,
    );
    return migrateVersionFourDocument(await migrateVersionThreeDocument(document));
  }
  if (version === 2) {
    const document = await defineRevisionedSnapshot(
      VersionTwoDesignDocumentContentSchema,
      value,
      normalizeBaseDocument,
    );
    return migrateVersionFourDocument(await migrateVersionThreeDocument(await migrateVersionTwoDocument(document)));
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
  return migrateVersionFourDocument(await migrateVersionThreeDocument(await migrateVersionTwoDocument(versionTwo)));
}

export async function createDesignDocument(input: unknown): Promise<DesignDocument> {
  const value = CreateDesignDocumentInputSchema.parse(input);
  return defineDesignDocument(initialDocumentContent(value));
}
