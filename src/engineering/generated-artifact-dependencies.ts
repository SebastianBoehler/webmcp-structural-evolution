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

function reachedRequestInputs(
  id: string, graph: ReadonlyMap<string, ArtifactRecord>, inputIds: ReadonlySet<string>,
  visited = new Set<string>(), reached = new Set<string>(),
): ReadonlySet<string> {
  if (visited.has(id)) return reached;
  visited.add(id);
  if (inputIds.has(id)) reached.add(id);
  const record = graph.get(id);
  for (const dependency of record?.dependencies ?? []) {
    if (dependency.kind === "artifact") {
      reachedRequestInputs(dependency.artifactId, graph, inputIds, visited, reached);
    }
  }
  return reached;
}

function completeMechanismEntities(request: EngineeringSolveRequest<unknown>, record: ArtifactRecord): boolean {
  const dependencies = new Set(record.dependencies.flatMap((dependency) =>
    dependency.kind === "entity" ? [dependency.reference] : []));
  const required = [
    `document:${request.document.id}`, `study:${request.studyId}`,
    ...request.document.parameters.map(({ id }) => `parameter:${id}`),
    ...request.document.features.map(({ id }) => `feature:${id}`),
    ...request.document.bodies.map(({ id }) => `body:${id}`),
    ...request.document.components.map(({ id }) => `component:${id}`),
    ...request.document.instances.map(({ id }) => `instance:${id}`),
    ...request.document.mates.map(({ id }) => `mate:${id}`),
  ];
  return required.every((reference) => dependencies.has(reference));
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
  if (cyclicArtifactDependency(records, request.inputArtifacts)) {
    return "Generated artifact dependencies cannot contain a cycle";
  }
  const graph = new Map([...request.inputArtifacts, ...records].map((record) => [record.id, record]));
  if (inputIds.size > 0) {
    const unlined = records.find((record) =>
      reachedRequestInputs(record.id, graph, inputIds).size !== inputIds.size);
    return unlined
      ? `Generated artifact must reach every authoritative request input: ${unlined.id}`
      : undefined;
  }
  if (request.kind !== "mechanism") {
    return "Solver request has no authoritative artifact input lineage";
  }
  return records.every((record) => completeMechanismEntities(request, record))
    ? undefined
    : "Mechanism result lacks conservative exact-document entity lineage";
}
