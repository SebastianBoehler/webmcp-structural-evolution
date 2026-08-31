import { z } from "zod";

import { LengthUnitSchema } from "../domain/engineering-units";
import { revisionId } from "../domain/revisions";
import { freezeSnapshot, RevisionSchema, type DeepReadonly } from "../domain/snapshots";
import { SemanticReferenceSchema } from "./document-schema";

export const ArtifactKindSchema = z.enum([
  "brep",
  "render-mesh",
  "collision-mesh",
  "sdf",
  "solver-mesh",
  "field",
  "manufacturing-mesh",
  "mechanism-replay",
  "toolpath",
  "thumbnail",
  "export",
]);

const ArtifactDependencySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entity"), reference: SemanticReferenceSchema }).strict(),
  z.object({ kind: z.literal("artifact"), artifactId: RevisionSchema }).strict(),
]);

const ArtifactRecordContentSchema = z.object({
  kind: ArtifactKindSchema,
  sourceRevision: RevisionSchema,
  producer: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
  settingsDigest: RevisionSchema,
  contentDigest: RevisionSchema,
  units: LengthUnitSchema,
  mediaType: z.string().min(1),
  dependencies: z.array(ArtifactDependencySchema),
}).strict();

const ArtifactRecordShapeSchema = ArtifactRecordContentSchema.extend({ id: RevisionSchema }).strict();
const ArtifactRecordInputSchema = ArtifactRecordContentSchema.extend({ id: RevisionSchema.optional() }).strict();
const verifiedArtifactRecords = new WeakSet<object>();

export const ArtifactRecordSchema = ArtifactRecordShapeSchema
  .transform(async (candidate, context) => {
    const { id, dependencies, ...content } = candidate;
    const canonical = { ...content, dependencies: sortDependencies(dependencies) };
    const derivedId = await revisionId(canonical);
    if (id !== derivedId) {
      context.addIssue({ code: "custom", path: ["id"], message: "Artifact ID does not match canonical content" });
      return z.NEVER;
    }
    const verified = freezeSnapshot({ ...canonical, id });
    verifiedArtifactRecords.add(verified);
    return verified;
  })
  .brand<"VerifiedArtifactRecord">();

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactRecord = DeepReadonly<z.output<typeof ArtifactRecordSchema>>;
export type ArtifactIndex = DeepReadonly<{
  documentRevision: string;
  artifacts: readonly ArtifactRecord[];
}>;

function dependencyKey(dependency: z.infer<typeof ArtifactDependencySchema>): string {
  return dependency.kind === "entity"
    ? `entity:${dependency.reference}`
    : `artifact:${dependency.artifactId}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortDependencies(dependencies: readonly z.infer<typeof ArtifactDependencySchema>[]) {
  return [...dependencies].sort((left, right) => compareText(dependencyKey(left), dependencyKey(right)));
}

export async function defineArtifactRecord(value: unknown): Promise<ArtifactRecord> {
  const candidate = ArtifactRecordInputSchema.parse(value);
  const { id: claimedId, dependencies, ...content } = candidate;
  const canonical = { ...content, dependencies: sortDependencies(dependencies) };
  const id = await revisionId(canonical);

  if (claimedId !== undefined && claimedId !== id) {
    throw new Error("Artifact ID does not match canonical content");
  }

  return ArtifactRecordSchema.parseAsync({ ...canonical, id });
}

export function createArtifactIndex(documentRevision: string, artifacts: readonly ArtifactRecord[]): ArtifactIndex {
  const parsedRevision = RevisionSchema.parse(documentRevision);
  const records = artifacts.map((artifact) => {
    if (!verifiedArtifactRecords.has(artifact)) {
      throw new Error("Artifact index requires a verified artifact record");
    }
    return artifact;
  });
  const artifactIds = new Set<string>();
  for (const artifact of records) {
    if (artifactIds.has(artifact.id)) throw new Error(`Duplicate artifact ID: ${artifact.id}`);
    artifactIds.add(artifact.id);
  }
  for (const artifact of records) {
    for (const dependency of artifact.dependencies) {
      if (dependency.kind === "artifact" && !artifactIds.has(dependency.artifactId)) {
        throw new Error(`Dangling artifact dependency: ${dependency.artifactId}`);
      }
    }
  }

  return freezeSnapshot({
    documentRevision: parsedRevision,
    artifacts: records.sort((left, right) => compareText(left.id, right.id)),
  });
}
