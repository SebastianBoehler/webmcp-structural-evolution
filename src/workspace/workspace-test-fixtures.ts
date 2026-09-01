import { defineArtifactRecord, type ArtifactRecord } from "../cad/artifact-contract";
import type { DesignTransaction } from "../cad/command-schema";
import type { DesignDocument } from "../cad/document-schema";
import type {
  CadEvaluationEvent, CadEvaluationRequest, CadKernelAdapter,
} from "../cad/runtime-contracts";
import { digestCadOutputPayload } from "../cad/rebuild-payload";
import { createDesignSession } from "../cad/design-session";
import { defineEngineeringSolveRequest } from "../cad/engineering-job-contract";
import { createArtifactStore, type ArtifactPayload } from "../engineering/artifact-store";
import { sourceDocument } from "../engineering/job-runner-test-fixtures";
import { createSolverRegistry } from "../engineering/solver-registry";
import type { EngineeringSolveRequest, SolverAdapter, SolverRunResult } from "../engineering/solver-adapter";
import type {
  EngineeringWorkspaceOptions, StudyRequestPlanner,
} from "./engineering-workspace-service";

export const human = { kind: "human", id: "sebastian" } as const;
export const agent = { kind: "agent", id: "design-agent" } as const;

export const rename = (
  document: DesignDocument,
  id: string,
  label: string,
  actor: DesignTransaction["actor"] = human,
): DesignTransaction => ({
  id,
  expectedRevision: document.revision,
  actor,
  preconditions: [],
  commands: [{ id: `${id}-rename`, type: "rename-document", label }],
});

export async function cadResult(
  request: Readonly<{
    requestId: string;
    document: DesignDocument;
    sourceRevision: string;
    requestedOutputs: readonly string[];
  }>,
  value = 7,
): Promise<Extract<CadEvaluationEvent, { state: "succeeded" }>> {
  const payload = { bytes: Uint8Array.of(value) };
  const artifact = await defineArtifactRecord({
    kind: "export",
    sourceRevision: request.sourceRevision,
    producer: { name: "test-cad", version: "1.0.0" },
    settingsDigest: "a".repeat(64),
    contentDigest: await digestCadOutputPayload(payload),
    units: "m",
    mediaType: "model/step",
    dependencies: [{ kind: "entity", reference: "document:link" }],
  });
  return {
    requestId: request.requestId,
    state: "succeeded",
    sourceRevision: request.sourceRevision,
    requestedOutputs: ["step"],
    results: [{ output: "step", artifact, payload }],
  };
}

export function cadAdapter(
  evaluate: CadKernelAdapter["evaluate"],
  dispose = () => undefined,
): CadKernelAdapter {
  return {
    evaluate,
    async importStep() { throw new Error("STEP import is outside the workspace test boundary"); },
    dispose,
  };
}

export async function solveResult(
  request: EngineeringSolveRequest<unknown>,
  value: number,
  duplicate = false,
): Promise<SolverRunResult<{ readonly completed: true }>> {
  const payload = Uint8Array.of(value);
  const { digestArtifactPayload } = await import("../engineering/artifact-store");
  const record = await defineArtifactRecord({
    kind: "field",
    sourceRevision: request.sourceRevision,
    producer: { name: "test-fea", version: "1.0.0" },
    settingsDigest: "b".repeat(64),
    contentDigest: await digestArtifactPayload(payload),
    units: "m",
    mediaType: "application/vnd.engineering.field",
    dependencies: [{ kind: "entity", reference: `study:${request.studyId}` }],
  });
  const generated = { record, payload };
  return {
    output: { completed: true },
    truthLevel: "converged-numerical-solve",
    artifacts: duplicate ? [generated, generated] : [generated],
  };
}

export type RunGate = Readonly<{
  started: Promise<void>;
  release: (result: SolverRunResult<{ readonly completed: true }>) => void;
}>;

export function gatedAdapter(): Readonly<{
  adapter: SolverAdapter<unknown, { readonly completed: true }>;
  gate: RunGate;
  signal: () => AbortSignal | undefined;
}> {
  let start!: () => void;
  let release!: (result: SolverRunResult<{ readonly completed: true }>) => void;
  let observedSignal: AbortSignal | undefined;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const completion = new Promise<SolverRunResult<{ readonly completed: true }>>((resolve) => { release = resolve; });
  return {
    adapter: {
      capability: { kind: "fea" },
      supports: () => ({ supported: true }),
      run: async (_request, signal) => {
        observedSignal = signal;
        start();
        return completion;
      },
    },
    gate: { started, release },
    signal: () => observedSignal,
  };
}

export function immediateAdapter(
  duplicate = false,
  seen: EngineeringSolveRequest<unknown>[] = [],
  valueForRequest: (request: EngineeringSolveRequest<unknown>) => number =
    (request) => request.jobId.endsWith("two") ? 2 : 1,
): SolverAdapter<unknown, { readonly completed: true }> {
  return {
    capability: { kind: "fea" },
    supports: () => ({ supported: true }),
    async run(request) {
      seen.push(request);
      return solveResult(request, valueForRequest(request), duplicate);
    },
  };
}

export function structuralPlanner(
  calls: Array<{ readonly kind: string; readonly studyId: string }> = [],
): StudyRequestPlanner<"structural-linear"> {
  let sequence = 0;
  return async ({ document, study, artifacts }) => {
    sequence += 1;
    calls.push({ kind: study.kind, studyId: study.id });
    const request = await defineEngineeringSolveRequest({
      jobId: `workspace-job-${sequence === 1 ? "one" : "two"}`,
      kind: "fea",
      sourceRevision: document.revision,
      inputArtifacts: artifacts,
      settings: { precision: "f32" },
      studyId: study.id,
      input: { exactStudyKind: study.kind },
      document,
    });
    return { request, inputs: [] };
  };
}

export async function workspaceOptions(
  overrides: Partial<EngineeringWorkspaceOptions> = {},
): Promise<EngineeringWorkspaceOptions> {
  const document = await sourceDocument();
  const registry = createSolverRegistry();
  registry.register(immediateAdapter());
  return {
    session: createDesignSession(document),
    store: createArtifactStore(),
    registry,
    createCadAdapter: () => cadAdapter(async (request, _signal, emit) => emit(await cadResult(request))),
    planners: { "structural-linear": structuralPlanner() },
    clock: { now: () => "2026-09-01T10:00:00.000Z", elapsedMs: () => 1 },
    ...overrides,
  };
}

export async function artifactPayload(
  store: { get(id: string): Promise<ArtifactPayload | undefined> },
  record: ArtifactRecord,
) {
  return store.get(record.id);
}
