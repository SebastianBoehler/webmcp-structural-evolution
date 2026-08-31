import type { ArtifactRecord } from "../cad/artifact-contract";
import type { DesignDocument } from "../cad/document-schema";
import type { EngineeringSolveRequest } from "../cad/engineering-job-contract";

function referenceSet(document: DesignDocument): ReadonlySet<string> {
  const references = new Set<string>([`document:${document.id}`]);
  const collections = [
    ["parameter", document.parameters], ["frame", document.frames], ["sketch", document.sketches],
    ["feature", document.features], ["body", document.bodies], ["component", document.components],
    ["instance", document.instances], ["mate", document.mates], ["named-selection", document.namedSelections],
    ["material", document.materials], ["study", document.studies],
  ] as const;
  for (const [kind, values] of collections) {
    for (const value of values) references.add(`${kind}:${value.id}`);
  }
  return references;
}

function cyclicArtifactDependency(
  records: readonly ArtifactRecord[],
  inputs: readonly ArtifactRecord[],
): boolean {
  const allRecords = [...inputs, ...records];
  const ids = new Set(allRecords.map(({ id }) => id));
  const graph = new Map<string, readonly string[]>();
  for (const record of allRecords) {
    graph.set(record.id, record.dependencies.flatMap((dependency) =>
      dependency.kind === "artifact" && ids.has(dependency.artifactId) ? [dependency.artifactId] : []));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((graph.get(id) ?? []).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...graph.keys()].some(visit);
}

export function generatedArtifactDependencyError(
  request: EngineeringSolveRequest<unknown>,
  records: readonly ArtifactRecord[],
): string | undefined {
  const entities = referenceSet(request.document);
  const inputIds = new Set(request.inputArtifacts.map(({ id }) => id));
  const generatedIds = new Set(records.map(({ id }) => id));
  const ownership = `study:${request.studyId}`;
  for (const record of records) {
    if (!record.dependencies.some((dependency) => dependency.kind === "entity" && dependency.reference === ownership)) {
      return `Generated artifact must depend on its source study: ${ownership}`;
    }
    for (const dependency of record.dependencies) {
      if (dependency.kind === "entity" && !entities.has(dependency.reference)) {
        return `Generated artifact references an entity outside the source document: ${dependency.reference}`;
      }
      if (dependency.kind === "artifact") {
        if (dependency.artifactId === record.id) return "Generated artifact cannot depend on itself";
        if (!inputIds.has(dependency.artifactId) && !generatedIds.has(dependency.artifactId)) {
          return `Generated artifact has a dangling dependency: ${dependency.artifactId}`;
        }
      }
    }
  }
  return cyclicArtifactDependency(records, request.inputArtifacts)
    ? "Generated artifact dependencies cannot contain a cycle"
    : undefined;
}
