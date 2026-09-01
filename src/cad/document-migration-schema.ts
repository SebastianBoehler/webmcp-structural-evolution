import { z } from "zod";

import { RevisionSchema } from "../domain/snapshots";

export const V1MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(1),
  sourceRevision: RevisionSchema,
}).strict();

export const V2MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(2),
  sourceRevision: RevisionSchema,
  sourceMigrationProvenance: V1MigrationProvenanceSchema.optional(),
}).strict();

export const V3MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(3),
  sourceRevision: RevisionSchema,
  sourceMigrationProvenance: V2MigrationProvenanceSchema.optional(),
}).strict();

export const V4MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(4),
  sourceRevision: RevisionSchema,
  sourceMigrationProvenance: V3MigrationProvenanceSchema.optional(),
}).strict();

export const V5MigrationProvenanceSchema = z.object({
  sourceSchemaVersion: z.literal(5),
  sourceRevision: RevisionSchema,
  sourceMigrationProvenance: V4MigrationProvenanceSchema.optional(),
}).strict();
