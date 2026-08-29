import { freezeSnapshot, RevisionSchema } from "../domain/snapshots";
import type { ChangedReference } from "./command-schema";
import { createArtifactIndex, type ArtifactIndex } from "./artifact-contract";

export function invalidateArtifacts(
  index: ArtifactIndex,
  changedReferences: readonly ChangedReference[],
  nextRevision: string,
) {
  const changed = new Set(changedReferences);
  const invalidated = new Set<string>();

  for (const artifact of index.artifacts) {
    if (artifact.dependencies.some((dependency) =>
      dependency.kind === "entity" && changed.has(dependency.reference))) {
      invalidated.add(artifact.id);
    }
  }

  let added = true;
  while (added) {
    added = false;
    for (const artifact of index.artifacts) {
      if (invalidated.has(artifact.id)) continue;
      if (artifact.dependencies.some((dependency) =>
        dependency.kind === "artifact" && invalidated.has(dependency.artifactId))) {
        invalidated.add(artifact.id);
        added = true;
      }
    }
  }

  const documentRevision = RevisionSchema.parse(nextRevision);
  const artifacts = index.artifacts.filter((artifact) => !invalidated.has(artifact.id));
  return freezeSnapshot({
    index: createArtifactIndex(documentRevision, artifacts),
    invalidatedIds: [...invalidated].sort(),
  });
}
