import { createOcctCadAdapter } from "../cad/kernel/occt-adapter";
import { createDesignSession } from "../cad/design-session";
import type { AuthoritativeComponentDocument } from "../models/component-documents";
import { createArtifactStore, type ArtifactPayload } from "../engineering/artifact-store";
import { createSolverRegistry } from "../engineering/solver-registry";
import type {
  EngineeringSolveRequest, SolverAdapter, SolverRunResult,
} from "../engineering/solver-adapter";
import { createComponentStudyPlanners } from "./component-study-planners";
import { createEngineeringWorkspaceService } from "./engineering-workspace-service";

export type ComponentStudyRun<Input, Output> = Readonly<{
  request: EngineeringSolveRequest<Input>;
  result: SolverRunResult<Output>;
  artifactIds: readonly string[];
  readArtifact(id: string): Promise<ArtifactPayload | undefined>;
}>;

const terminal = new Set(["verified", "failed", "cancelled"]);

export async function runComponentStudy<Input, Output>(
  model: AuthoritativeComponentDocument,
  studyId: string,
  productionAdapter: SolverAdapter<Input, Output>,
  signal: AbortSignal,
): Promise<ComponentStudyRun<Input, Output>> {
  let capturedRequest: EngineeringSolveRequest<Input> | undefined;
  let capturedResult: SolverRunResult<Output> | undefined;
  const adapter: SolverAdapter<Input, Output> = {
    capability: productionAdapter.capability,
    supports: (request) => productionAdapter.supports(request),
    async run(request, activeSignal, emit) {
      capturedRequest = request;
      const result = await productionAdapter.run(request, activeSignal, emit);
      capturedResult = result;
      return result;
    },
  };
  const registry = createSolverRegistry(), store = createArtifactStore();
  registry.register(adapter);
  const workspace = createEngineeringWorkspaceService({
    session: createDesignSession(model.document), store, registry,
    createCadAdapter: createOcctCadAdapter,
    planners: createComponentStudyPlanners(model),
    clock: { now: () => new Date().toISOString(), elapsedMs: () => 0 },
  });
  let launchedJobId: string | undefined;
  let rejectCancellation!: (reason?: unknown) => void;
  const cancellationFailure = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const cancel = () => {
    if (launchedJobId) void workspace.cancelJob(launchedJobId).catch((error) => {
      workspace.dispose();
      rejectCancellation(error);
    });
    else workspace.dispose();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw signal.reason;
    const launched = await workspace.launchStudy({
      studyId, expectedRevision: model.document.revision,
    });
    launchedJobId = launched.jobId;
    const terminalEntry = new Promise<ReturnType<typeof workspace.inspectJob>>((resolve) => {
      const current = workspace.inspectJob(launched.jobId);
      if (terminal.has(current.event.state)) { resolve(current); return; }
      const unsubscribe = workspace.subscribe((event) => {
        if (event.type !== "job-changed" || event.entry.event.jobId !== launched.jobId
          || !terminal.has(event.entry.event.state)) return;
        unsubscribe();
        resolve(event.entry);
      });
    });
    const entry = await Promise.race([terminalEntry, cancellationFailure]);
    if (entry.event.state === "cancelled" && signal.aborted) throw signal.reason;
    if (entry.event.state !== "verified" || !capturedRequest || !capturedResult) {
      const detail = entry.event.state === "failed"
        ? ` (${entry.event.error.code}): ${entry.event.error.message}` : "";
      throw new Error(`Component study ${studyId} ended as ${entry.event.state}${detail}`);
    }
    return Object.freeze({
      request: capturedRequest, result: capturedResult,
      artifactIds: entry.event.artifacts.map(({ id }) => id),
      readArtifact: (id: string) => store.get(id),
    });
  } finally {
    signal.removeEventListener("abort", cancel);
    workspace.dispose();
  }
}
