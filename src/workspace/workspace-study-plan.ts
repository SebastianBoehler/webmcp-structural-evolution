import { defineArtifactRecord, type ArtifactRecord } from "../cad/artifact-contract";
import { defineEngineeringSolveRequest, type EngineeringJobKind } from "../cad/engineering-job-contract";
import type { DesignDocument } from "../cad/document-schema";
import { artifactPayloadInternals } from "../engineering/artifact-payload";
import type { ArtifactStoreBatchEntry } from "../engineering/artifact-store";
import type { EngineeringSolveRequest } from "../engineering/solver-adapter";
import type { Study } from "../engineering/study-schema";
import { WorkspaceError } from "./workspace-cad";

type StudyKind = Study["kind"];
type StudyOfKind<Kind extends StudyKind> = Extract<Study, { kind: Kind }>;

export type StudyCompilation = Readonly<{
  request: EngineeringSolveRequest<unknown>;
  inputs: readonly ArtifactStoreBatchEntry[];
}>;

export type StudyRequestPlanner<Kind extends StudyKind> = (input: Readonly<{
  document: DesignDocument;
  study: StudyOfKind<Kind>;
  artifacts: readonly ArtifactRecord[];
}>) => Promise<StudyCompilation>;

export type StudyRequestPlanners = Partial<{
  [Kind in StudyKind]: StudyRequestPlanner<Kind>;
}>;

const jobKind: Readonly<Record<StudyKind, EngineeringJobKind>> = {
  "structural-linear": "fea",
  topology: "topology",
  mechanism: "mechanism",
  "thermal-steady": "thermal",
};

function own<Value>(value: Value): Value {
  try { return structuredClone(value); }
  catch { throw new WorkspaceError("invalid-input", "Study compilation cannot contain shared or uncloneable memory"); }
}

export async function validateStudyCompilation(
  compilation: StudyCompilation,
  document: DesignDocument,
  study: Readonly<Pick<Study, "id" | "kind">>,
  activeArtifacts: readonly ArtifactRecord[],
): Promise<StudyCompilation> {
  const ownedInputs = compilation.inputs.map((entry) => ({
    record: own(entry.record),
    payload: artifactPayloadInternals.copy(artifactPayloadInternals.normalize(entry.payload)),
  }));
  const request = await defineEngineeringSolveRequest(own(compilation.request));
  if (request.sourceRevision !== document.revision
    || request.document.revision !== document.revision
    || request.studyId !== study.id
    || request.kind !== jobKind[study.kind]) {
    throw new WorkspaceError("invalid-study-request", "Study planner returned an incorrectly bound solve request");
  }
  const requestIds = new Set(request.inputArtifacts.map(({ id }) => id));
  const availableIds = new Set(activeArtifacts.map(({ id }) => id));
  const seen = new Set<string>();
  const inputs: ArtifactStoreBatchEntry[] = [];
  for (const entry of ownedInputs) {
    const record = await defineArtifactRecord(entry.record);
    if (seen.has(record.id)) {
      throw new WorkspaceError("invalid-study-input", `Study compilation repeats input artifact: ${record.id}`);
    }
    if (record.sourceRevision !== document.revision || !requestIds.has(record.id)) {
      throw new WorkspaceError("invalid-study-input", "Compiled input record is not current and bound into the solve request");
    }
    seen.add(record.id);
    availableIds.add(record.id);
    inputs.push({ record, payload: entry.payload });
  }
  if (request.inputArtifacts.some(({ id }) => !availableIds.has(id))) {
    throw new WorkspaceError(
      "invalid-study-input",
      "Solve request references an artifact outside the active exact model or compiled input batch",
    );
  }
  return { request, inputs };
}
