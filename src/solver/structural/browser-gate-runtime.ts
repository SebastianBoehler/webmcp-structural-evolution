import { createArtifactStore, type ArtifactStore } from "../../engineering/artifact-store";
import { createEngineeringJobRunner } from "../../engineering/job-runner";
import { createSolverRegistry } from "../../engineering/solver-registry";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import { createWebGpuTopologyAdapter } from "../topology/topology-adapter";
import type { StructuralGpuAcquisitionObserver } from "./structural-gpu-runtime";
import { createWebGpuStructuralAdapter } from "./webgpu-structural-adapter";
import type { ExactBrowserBenchmark } from "./browser-gate-exact-benchmark";
import type { StructuralResult, StructuralSolveInput } from "./structural-contract";

const now = () => performance.now();
function runtime(document: ExactBrowserBenchmark["structuralRequest"]["document"], observe: StructuralGpuAcquisitionObserver) {
  const registry = createSolverRegistry();
  registry.register(createWebGpuStructuralAdapter({ onAcquisition: observe }));
  registry.register(createWebGpuTopologyAdapter({ onAcquisition: observe }));
  const committedIds = new Set<string>(), base = createArtifactStore();
  const store: ArtifactStore = { put: (record, payload) => base.put(record, payload),
    get: (id) => base.get(id), delete: (ids) => base.delete(ids), async commit(entries, guard) {
      await base.commit(entries, guard);
      entries.forEach(({ record }) => committedIds.add(record.id));
    } };
  return { runner: createEngineeringJobRunner({ registry, store,
    currentDocument: () => document }), committedIds };
}

export async function solveGateRequest<Input, Output>(
  request: EngineeringSolveRequest<Input>, observe: StructuralGpuAcquisitionObserver,
) {
  const completion = await runtime(request.document, observe).runner.launch<Input, Output>(request).completion;
  if ("output" in completion) return { output: completion.output, artifacts: completion.event.artifacts };
  throw new Error(completion.event.state === "failed"
    ? `${request.jobId} failed (${completion.event.error.code}): ${completion.event.error.message}`
    : `${request.jobId} was unexpectedly cancelled`);
}

export async function runStructuralCancellationCase(
  benchmark: ExactBrowserBenchmark, observe: StructuralGpuAcquisitionObserver,
) {
  const active = runtime(benchmark.structuralRequest.document, observe), started = now();
  const request = { ...benchmark.structuralRequest, jobId: "live-cancellation-probe" };
  let cancelled = false;
  const unsubscribe = active.runner.subscribe(({ event }) => {
    if (event.jobId === request.jobId && event.state === "partial" && event.progress > .05 && !cancelled) {
      cancelled = active.runner.cancel(request.jobId);
    }
  });
  const completion = await active.runner.launch<StructuralSolveInput, StructuralResult>(request).completion;
  unsubscribe();
  if (!cancelled || completion.event.state !== "cancelled") {
    throw new Error("Live structural cancellation did not terminate as cancelled");
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const terminals = () => active.runner.entries().filter(({ event }) => event.jobId === request.jobId
    && ["verified", "failed", "cancelled"].includes(event.state));
  if (terminals().length !== 1 || active.committedIds.size !== 0) {
    throw new Error("Cancelled structural run emitted a late terminal or committed artifacts");
  }
  const recovery = await active.runner.launch<StructuralSolveInput, StructuralResult>({
    ...benchmark.structuralRequest, jobId: "live-cancellation-recovery",
  }).completion;
  if (recovery.event.state !== "verified") throw new Error("Fresh structural run did not recover after cancellation");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (terminals().length !== 1) throw new Error("Cancelled structural run emitted a late terminal or committed artifacts");
  return { outcome: "cancelled" as const, lateTerminal: false as const,
    artifactsCommitted: 0 as const, recoveryRunPassed: true as const, timingMs: now() - started };
}
