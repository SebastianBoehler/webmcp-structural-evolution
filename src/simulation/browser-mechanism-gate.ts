import { defineEngineeringSolveRequest } from "../cad/engineering-job-contract";
import { revisionId } from "../domain/revisions";
import { createArtifactStore, type ArtifactStore } from "../engineering/artifact-store";
import { createEngineeringJobRunner } from "../engineering/job-runner";
import { createSolverRegistry } from "../engineering/solver-registry";
import type { EngineeringSolveRequest, SolverAdapter } from "../engineering/solver-adapter";
import {
  buildComponentMechanismShowcase, componentMechanismEvidence, type ComponentMechanismShowcase,
} from "./component-mechanism-showcase";
import type { Se6MechanismBenchmark } from "../samples/cobot/cobot-mechanism-study";
import { SE6_STAGE_IDS } from "../samples/cobot/cobot-mechanism-geometry";
import { createGateConsoleAudit } from "../solver/structural/browser-gpu-audit";
import { createMechanismAdapter, type MechanismAdapterInput } from "./mechanism-adapter";
import { MECHANISM_STEP_HZ, type MechanismInput } from "./mechanism-contract";
import {
  parseMechanismBrowserGateReport, sealMechanismBrowserGateReport,
  verifyMechanismBrowserGateReportDigest, type MechanismBrowserGateReport,
} from "./browser-mechanism-report";
import {
  resolveMechanismResult, type MechanismResult,
} from "./mechanism-solver";
const terminalStates = new Set(["verified", "failed", "cancelled"]);
const now = () => performance.now();
const abortIfRequested = (signal: AbortSignal) => {
  if (signal.aborted) throw signal.reason instanceof Error
    ? signal.reason : new DOMException("Mechanism browser gate was cancelled", "AbortError");
};
type GateBenchmark = ComponentMechanismShowcase | Se6MechanismBenchmark;
export type MechanismBrowserGateSession = Readonly<{
  report: MechanismBrowserGateReport;
  result?: MechanismResult;
  input?: MechanismInput;
  benchmark?: GateBenchmark;
  model?: import("../workspace/component-showcase-evidence").ShowcaseModelEvidence;
}>;
type Adapter = SolverAdapter<MechanismAdapterInput, MechanismResult>;
type GateDependencies = Readonly<{
  buildBenchmark?: (signal: AbortSignal) => Promise<GateBenchmark>;
  createAdapter?: () => Adapter;
  resolveResult?: typeof resolveMechanismResult;
}>;
function runtimeFor(document: GateBenchmark["document"], adapter: Adapter) {
  const registry = createSolverRegistry();
  registry.register(adapter);
  const base = createArtifactStore(), committedIds = new Set<string>();
  const store: ArtifactStore = {
    put: (record, payload) => base.put(record, payload), get: (id) => base.get(id),
    delete: (ids) => base.delete(ids),
    async commit(entries, guard) {
      await base.commit(entries, guard);
      for (const { record } of entries) committedIds.add(record.id);
    },
  };
  return {
    runner: createEngineeringJobRunner({ registry, store, currentDocument: () => document }),
    committedIds,
  };
}
async function requestFor(benchmark: GateBenchmark, jobId: string) {
  if ("request" in benchmark) return defineEngineeringSolveRequest<MechanismAdapterInput>({
    ...benchmark.request, jobId, settings: { gate: "se6-mechanism-browser-v2" },
  });
  return defineEngineeringSolveRequest<MechanismAdapterInput>({
    jobId, kind: "mechanism", sourceRevision: benchmark.document.revision,
    inputArtifacts: [], settings: { gate: "legacy-test-only" }, studyId: "se6-motion",
    document: benchmark.document, input: { schemaVersion: 1 },
  });
}
async function cancellationAndRecovery(
  benchmark: GateBenchmark, adapter: Adapter, signal: AbortSignal,
) {
  abortIfRequested(signal);
  const runtime = runtimeFor(benchmark.document, adapter), started = now();
  const cancellationRequest = await requestFor(benchmark, "se6-live-cancellation-probe");
  abortIfRequested(signal);
  let cancelled = false, workerStarted = false;
  const unsubscribe = runtime.runner.subscribe(({ event }) => {
    if (event.jobId === cancellationRequest.jobId && event.state === "partial"
      && event.partial?.kind === "mechanism-worker-started" && !cancelled) {
      workerStarted = true;
      cancelled = runtime.runner.cancel(event.jobId);
    }
  });
  let activeJobId = cancellationRequest.jobId;
  const abortActive = () => runtime.runner.cancel(activeJobId);
  signal.addEventListener("abort", abortActive, { once: true });
  try {
    abortIfRequested(signal);
    const cancelledCompletion = await runtime.runner
      .launch<MechanismAdapterInput, MechanismResult>(cancellationRequest).completion;
    abortIfRequested(signal);
    unsubscribe();
    const cancelledTerminals = runtime.runner.entries().filter(({ event }) =>
      event.jobId === cancellationRequest.jobId && terminalStates.has(event.state));
    const cancellationCommitted = runtime.committedIds.size;
    if (!workerStarted || !cancelled || cancelledCompletion.event.state !== "cancelled"
      || cancelledTerminals.length !== 1 || cancellationCommitted !== 0) {
      throw new Error("Mechanism in-flight cancellation invariant failed: "
        + `workerStarted=${workerStarted} cancellationRequested=${cancelled} completion=${cancelledCompletion.event.state} `
        + `terminalCount=${cancelledTerminals.length} commitCount=${cancellationCommitted}`
        + (cancelledCompletion.event.state === "failed" ? ` failure=${cancelledCompletion.event.error.code}:${cancelledCompletion.event.error.message}` : ""));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    abortIfRequested(signal);
    const settledProbeTerminals = runtime.runner.entries().filter(({ event }) =>
      event.jobId === cancellationRequest.jobId && terminalStates.has(event.state));
    if (settledProbeTerminals.length !== 1 || runtime.committedIds.size !== 0) {
      throw new Error("Mechanism cancellation probe changed after its terminal fence");
    }
    abortIfRequested(signal);
    const recoveryRequest = await requestFor(benchmark, "se6-live-cancellation-recovery");
    abortIfRequested(signal);
    activeJobId = recoveryRequest.jobId;
    abortIfRequested(signal);
    const recoveryLaunch = runtime.runner
      .launch<MechanismAdapterInput, MechanismResult>(recoveryRequest);
    abortIfRequested(signal);
    const recovery = await recoveryLaunch.completion;
    abortIfRequested(signal);
    if (!("output" in recovery)) {
      throw new Error(recovery.event.state === "failed"
        ? `Mechanism recovery failed (${recovery.event.error.code}): ${recovery.event.error.message}`
        : "Mechanism recovery was unexpectedly cancelled");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    abortIfRequested(signal);
    const lateTerminals = runtime.runner.entries().filter(({ event }) =>
      event.jobId === cancellationRequest.jobId && terminalStates.has(event.state));
    if (lateTerminals.length !== 1 || recovery.event.artifacts.length !== 1) {
      throw new Error("Mechanism cancellation recovery did not preserve one-terminal authority");
    }
    abortIfRequested(signal);
    return {
      output: recovery.output, artifactId: recovery.event.artifacts[0]!.id,
      evidence: { outcome: "cancelled" as const, lateTerminal: false as const,
        artifactsCommitted: 0 as const, recoveryRunPassed: true as const, workerStarted: true as const,
        cancellationRequestedAfterWorkerStart: true as const, timingMs: now() - started },
    };
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", abortActive);
  }
}
function collisionEvidence(input: MechanismInput) {
  const index = new Map<string, number>(SE6_STAGE_IDS.map((id, position) => [id, position]));
  let adjacentPairsDisabled = true, nonAdjacentPairsEnabled = true;
  for (let left = 0; left < input.colliders.length; left += 1) {
    for (let right = left + 1; right < input.colliders.length; right += 1) {
      const first = input.colliders[left]!, second = input.colliders[right]!;
      const separation = Math.abs(index.get(first.bodyId)! - index.get(second.bodyId)!);
      if (separation === 0) continue;
      const enabled = (first.membershipMask & second.filterMask) !== 0
        && (second.membershipMask & first.filterMask) !== 0;
      if (separation === 1 && enabled) adjacentPairsDisabled = false;
      if (separation > 1 && !enabled) nonAdjacentPairsEnabled = false;
    }
  }
  return { adjacentPairsDisabled, nonAdjacentPairsEnabled };
}

function motionEvidence(input: MechanismInput, result: MechanismResult) {
  const deltas: Record<string, number> = {};
  let limitsRespected = true;
  for (const joint of input.joints) {
    if (joint.kind !== "revolute") throw new Error("SE-6 benchmark contains a non-revolute joint");
    const positions = result.replay.frames.map((frame) => {
      const state = frame.joints.find(({ jointId }) => jointId === joint.id)!;
      if (state.kind !== "revolute") throw new Error(`SE-6 replay joint kind changed: ${joint.id}`);
      if (state.positionRad < joint.lowerRad - 1e-9 || state.positionRad > joint.upperRad + 1e-9) {
        limitsRespected = false;
      }
      return state.positionRad;
    });
    const authored = positions[0]!;
    deltas[joint.id] = positions.reduce((largest, value) =>
      Math.abs(value - authored) > Math.abs(largest) ? value - authored : largest, 0);
  }
  return { maximumJointDeltaFromAuthoredPoseRad: deltas,
    movingJointIds: Object.entries(deltas).filter(([, delta]) => Math.abs(delta) > 1e-4).map(([id]) => id),
    limitsRespected, maximumJointErrorM: result.evidence.verification.maximumJointErrorM };
}
function assertBenchmark(input: MechanismInput, benchmark: GateBenchmark): void {
  if (input.bodies.length !== 7 || input.joints.length !== 6
    || input.bodies.filter(({ kind }) => kind === "fixed").map(({ id }) => id).join() !== "base") {
    throw new Error("SE-6 compiled benchmark is not exactly six revolute axes on one fixed base");
  }
  if (benchmark.visualParts.length !== 52
    || new Set(Object.values(benchmark.partBodyIds)).size !== 7
    || benchmark.visualParts.some(({ selectionId }) => benchmark.partBodyIds[selectionId] === undefined)) {
    throw new Error("SE-6 visual ownership is incomplete");
  }
}
export async function runMechanismBrowserGate(
  signal: AbortSignal = new AbortController().signal, dependencies: GateDependencies = {},
): Promise<MechanismBrowserGateSession> {
  const started = now(), lines: string[] = [], consoleAudit = createGateConsoleAudit();
  const buildBenchmark = dependencies.buildBenchmark ?? buildComponentMechanismShowcase;
  const createAdapter = dependencies.createAdapter ?? createMechanismAdapter;
  const resolveResult = dependencies.resolveResult ?? resolveMechanismResult;
  let routeModel = dependencies.buildBenchmark ? undefined : await componentMechanismEvidence("failure");
  let stage = "exact-cad-benchmark";
  const status = (line: string) => { lines.push(line); console.info(`[mechanism-gate] ${line}`); };
  try {
    abortIfRequested(signal);
    const buildStarted = now();
    const benchmark = await buildBenchmark(signal);
    abortIfRequested(signal);
    const buildMs = now() - buildStarted;
    status("Exact SE-6 CAD, cylindrical joint intent, and 52-part ownership built");
    stage = "cancellation-and-recovery";
    abortIfRequested(signal);
    const adapter = createAdapter();
    abortIfRequested(signal);
    const solved = await cancellationAndRecovery(benchmark, adapter, signal);
    abortIfRequested(signal);
    status("In-flight cancellation, zero-commit fence, and fresh worker recovery passed");
    stage = "replay-evidence";
    abortIfRequested(signal);
    const { result, compiled } = resolveResult(solved.output);
    abortIfRequested(signal);
    const input = compiled.input;
    assertBenchmark(input, benchmark);
    const motion = motionEvidence(input, result), masks = collisionEvidence(input);
    if (!motion.limitsRespected || motion.movingJointIds.length < 3
      || !masks.adjacentPairsDisabled || !masks.nonAdjacentPairsEnabled
      || result.replay.minimumRequestedClearanceM === null) {
      throw new Error(`SE-6 replay acceptance failed: moving axes ${motion.movingJointIds.length}, `
        + `limits ${motion.limitsRespected}, adjacent collision disabled ${masks.adjacentPairsDisabled}, `
        + `nonadjacent collision enabled ${masks.nonAdjacentPairsEnabled}, `
        + `minimum clearance ${String(result.replay.minimumRequestedClearanceM)} m`);
    }
    if (motion.maximumJointErrorM > 1e-5 || result.replay.maximumPenetrationM > 1e-4) {
      const deepest = result.replay.contacts.reduce((maximum, contact) =>
        contact.penetrationM > (maximum?.penetrationM ?? -1) ? contact : maximum, undefined as
          typeof result.replay.contacts[number] | undefined);
      const colliderLabel = (id: string) => {
        const collider = input.colliders.find((candidate) => candidate.id === id);
        return collider ? `${collider.bodyId}:${collider.sourceBodyId}` : id;
      };
      throw new Error(`SE-6 numerical bounds failed: joint error ${motion.maximumJointErrorM} m, `
        + `penetration ${result.replay.maximumPenetrationM} m`
        + (deepest ? ` at step ${deepest.stepIndex} (${colliderLabel(deepest.firstColliderId)}`
          + `/${colliderLabel(deepest.secondColliderId)})` : ""));
    }
    status("Six-axis replay, limits, collision masks, and per-frame clearances passed");
    await Promise.resolve();
    abortIfRequested(signal);
    const consoleCounts = consoleAudit.evidence();
    if (consoleCounts.warningCount !== 0 || consoleCounts.errorCount !== 0) {
      throw new Error("Mechanism gate emitted console warnings or errors");
    }
    const content = {
      status: "passed" as const, evidenceSource: "live-browser-worker" as const,
      auditOnly: true as const, authorizesEngineeringResult: false as const,
      recordedAt: new Date().toISOString(),
      ids: { sourceRevision: result.sourceRevision, studyId: result.studyId,
        mechanismInputDigest: result.mechanismInputDigest, resultDigest: result.resultDigest,
        replayDigest: result.replay.replayDigest, replayArtifactId: solved.artifactId,
        sourceArtifactIds: [...result.sourceArtifactIds] },
      runtime: { engineVersion: result.evidence.engineVersion, runtimeVersion: result.evidence.runtimeVersion,
        runtimeDigest: result.evidence.runtimeDigest, solverBuildDigest: result.evidence.solverBuildDigest,
        wasmModuleDigest: result.evidence.wasmModuleDigest,
        workerArtifactDigest: result.evidence.workerArtifactDigest, settingsDigest: result.evidence.settingsDigest },
      benchmark: { bodyCount: 7 as const, revoluteJointCount: 6 as const,
        fixedBodyIds: ["base"] as ["base"], visualPartCount: 52 as const, bodyGroupCount: 7 as const,
        completeOwnership: true as const, frameCount: result.replay.frames.length,
        durationSteps: input.durationSteps, outputStrideSteps: input.outputStrideSteps,
        outputHz: MECHANISM_STEP_HZ / input.outputStrideSteps },
      motion: { ...motion, limitsRespected: true as const },
      collision: { adjacentPairsDisabled: true as const, nonAdjacentPairsEnabled: true as const,
        maximumPenetrationM: result.replay.maximumPenetrationM,
        minimumRequestedClearanceM: result.replay.minimumRequestedClearanceM,
        declaredClearancePairCount: input.clearancePairs.length,
        clearanceSampleCount: result.replay.clearanceSamples.length,
        contactEventCount: result.replay.contacts.length },
      cancellation: solved.evidence,
      timingsMs: { build: buildMs, solveAndRecovery: solved.evidence.timingMs, total: now() - started },
      solverPhaseConsole: { statusLines: lines, warningCount: 0 as const, errorCount: 0 as const },
    };
    abortIfRequested(signal);
    const report = await sealMechanismBrowserGateReport(content);
    abortIfRequested(signal);
    if (!await verifyMechanismBrowserGateReportDigest(report)) throw new Error("Mechanism gate report seal failed");
    abortIfRequested(signal);
    return { report, result, input, benchmark,
      ...("model" in benchmark ? { model: benchmark.model } : {}) };
  } catch (error) {
    if (signal.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mechanism-gate] ${stage}: ${message}`);
    return { report: parseMechanismBrowserGateReport({ status: "blocked",
      evidenceSource: "live-browser-worker", blocker: { stage, message },
      solverPhaseConsole: { statusLines: lines, ...consoleAudit.evidence() } }),
      ...(routeModel ? { model: routeModel } : {}) };
  } finally {
    consoleAudit.restore();
  }
}
