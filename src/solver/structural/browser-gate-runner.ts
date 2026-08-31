import { revisionId } from "../../domain/revisions";
import { createArtifactStore, type ArtifactStore } from "../../engineering/artifact-store";
import { createEngineeringJobRunner } from "../../engineering/job-runner";
import { createSolverRegistry } from "../../engineering/solver-registry";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import { createWebGpuTopologyAdapter } from "../topology/topology-adapter";
import { createTopologyMeshArtifact } from "../topology/topology-artifacts";
import type { TopologyMesh, TopologyResult, TopologySolveInput } from "../topology/topology-contract";
import { topologyMask } from "../topology/density-constraints";
import { rasterizeExtractedTopology } from "../topology/extract-topology";
import {
  BROWSER_BENCHMARKS, buildExactBrowserBenchmark, type BrowserBenchmarkId,
  type ExactBrowserBenchmark,
} from "./browser-gate-exact-benchmark";
import {
  STRUCTURAL_FORCE_BALANCE_TOLERANCE, STRUCTURAL_RESIDUAL_TOLERANCE,
  STRUCTURAL_VERIFICATION_METADATA, STRUCTURAL_WASM_L2_TOLERANCE,
  type StructuralResult, type StructuralSolveInput,
} from "./structural-contract";
import { createWebGpuStructuralAdapter } from "./webgpu-structural-adapter";
import {
  parseStructuralTopologyGateReport, verifyStructuralTopologyGateReportDigest,
  type StructuralTopologyGateReport,
} from "./browser-gate-report";
import { createGateConsoleAudit, createGateGpuAudit } from "./browser-gpu-audit";
import { analyticalEvidence } from "./browser-gate-analytical";
type PassedReport = Extract<StructuralTopologyGateReport, { status: "passed" }>;
type TopologyEvidence = PassedReport["topology"]["drone"];
export type GateTopologyCandidate = Readonly<{
  evidence: TopologyEvidence; mesh: TopologyMesh;
  request: EngineeringSolveRequest<TopologySolveInput>;
}>;
export type GateTopologyCandidates = Readonly<{
  drone: GateTopologyCandidate; cobot: GateTopologyCandidate;
}>;
const now = () => performance.now();
function numerical(result: StructuralResult) {
  const evidence = {
    iterations: result.iterations, relativeResidual: result.verification.relativeResidual,
    recomputedF32RelativeResidual: result.verification.recomputedF32RelativeResidual,
    gpuReactionBalanceErrorN: result.verification.gpuReactionBalanceErrorN,
    wasmForceBalanceErrorN: result.verification.wasmForceBalanceErrorN,
    wasmReactionN: [...result.verification.wasmReactionN] as [number, number, number],
    appliedLoadN: result.verification.appliedLoadN, wasmRelativeL2: result.verification.wasmRelativeL2,
    wasmFieldStressRelativeL2: result.verification.wasmFieldStressRelativeL2,
    energyRelativeMismatch: result.verification.energyRelativeMismatch,
    maximumDisplacementM: result.maximumDisplacementM,
    maximumVonMisesStressPa: result.maximumVonMisesStressPa,
  };
  return evidence;
}
type GateGpuAudit = ReturnType<typeof createGateGpuAudit>;
function runnerFor(document: ExactBrowserBenchmark["structuralRequest"]["document"], audit: GateGpuAudit) {
  const registry = createSolverRegistry();
  registry.register(createWebGpuStructuralAdapter({ onAcquisition: audit.observe }));
  registry.register(createWebGpuTopologyAdapter({ onAcquisition: audit.observe }));
  const committedIds = new Set<string>(), base = createArtifactStore();
  const store: ArtifactStore = {
    put: (record, payload) => base.put(record, payload),
    get: (id) => base.get(id), delete: (ids) => base.delete(ids),
    async commit(entries, guard) {
      await base.commit(entries, guard);
      for (const { record } of entries) committedIds.add(record.id);
    },
  };
  const runner = createEngineeringJobRunner({ registry, store, currentDocument: () => document });
  return { runner, store, committedIds };
}
async function solve<Input, Output>(request: EngineeringSolveRequest<Input>, audit: GateGpuAudit): Promise<{
  readonly output: Output; readonly artifacts: readonly { readonly id: string; readonly kind: string }[];
}> {
  const completion = await runnerFor(request.document, audit).runner
    .launch<Input, Output>(request).completion;
  if ("output" in completion) {
    return { output: completion.output, artifacts: completion.event.artifacts };
  }
  throw new Error(completion.event.state === "failed"
    ? `${request.jobId} failed (${completion.event.error.code}): ${completion.event.error.message}`
    : `${request.jobId} was unexpectedly cancelled`);
}
async function structuralCase(benchmark: ExactBrowserBenchmark, audit: GateGpuAudit) {
  const started = now();
  const solved = await solve<StructuralSolveInput, StructuralResult>(benchmark.structuralRequest, audit);
  if (solved.output.truthLevel !== "interactive-estimate" || solved.output.verification.realGpu !== true) {
    throw new Error(`${benchmark.definition.id} did not return real WebGPU structural evidence`);
  }
  return {
    exactBrepArtifactId: benchmark.exactBrepArtifact.id,
    semanticMeshArtifactId: benchmark.semanticMeshArtifact.id,
    voxelArtifactId: benchmark.structuralRequest.input.voxelArtifactId,
    bindingDigest: await revisionId({
      documentRevision: benchmark.structuralRequest.document.revision,
      studyId: benchmark.structuralRequest.studyId,
      namedSelections: benchmark.structuralRequest.document.namedSelections,
      artifacts: benchmark.structuralRequest.inputArtifacts.map(({ id }) => id),
    }),
    grid: {
      dimensions: [...solved.output.grid.cellDimensions] as [number, number, number],
      activeCells: benchmark.structuralRequest.input.voxelPayload.activeCells.reduce((sum, value) => sum + value, 0),
      cellSizeM: solved.output.grid.cellSizeM,
    },
    numerical: numerical(solved.output), analytical: analyticalEvidence(benchmark, solved.output),
    timingMs: now() - started,
  };
}
async function topologyCase(benchmark: ExactBrowserBenchmark, audit: GateGpuAudit) {
  if (!benchmark.topologyRequest || benchmark.definition.topologyTarget === undefined) {
    throw new Error(`${benchmark.definition.id} topology request is unavailable`);
  }
  const started = now();
  const solved = await solve<TopologySolveInput, TopologyResult>(benchmark.topologyRequest, audit);
  const output = solved.output;
  if (!output.acceptance.eligible || output.acceptance.reasons.length > 0) {
    const study = benchmark.topologyRequest.document.studies.find(
      ({ id }) => id === benchmark.topologyRequest!.studyId,
    );
    const sourceStudy = study?.kind === "topology"
      ? benchmark.topologyRequest.document.studies.find(({ id }) => id === study.sourceStudyId)
      : undefined;
    const material = sourceStudy?.kind === "structural-linear"
      ? benchmark.topologyRequest.document.materials.find(({ id }) => id === sourceStudy.materialId)
      : undefined;
    const stress = output.postExtractionAnalysis.maximumVonMisesStressPa;
    const safety = material?.kind === "isotropic" && stress > 0
      ? material.failureStressPa / stress : Number.NaN;
    throw new Error(`${benchmark.definition.id} topology is ineligible: ${output.acceptance.reasons.join(", ")}; `
      + `measured stress ${stress} Pa, safety ${safety}, displacement `
      + `${output.postExtractionAnalysis.maximumDisplacementM} m`);
  }
  if (Object.values(output.extraction).some((value) => value !== true)) {
    throw new Error(`${benchmark.definition.id} topology extraction evidence is incomplete`);
  }
  const source = benchmark.structuralRequest.input.voxelPayload;
  const finalMask = topologyMask(
    output.density, output.manufacturingMesh.isoValue, source.activeCells,
  );
  const rerasterized = rasterizeExtractedTopology(output.manufacturingMesh, output.postExtractionAnalysis.grid);
  const rerasterMatchesFinalMask = finalMask.length === rerasterized.length
    && finalMask.every((value, index) => value === rerasterized[index]);
  const initialActiveCells = source.activeCells.reduce((sum, value) => sum + value, 0);
  const finalActiveCells = finalMask.reduce((sum, value) => sum + value, 0);
  if (!rerasterMatchesFinalMask || finalActiveCells >= initialActiveCells) {
    throw new Error(`${benchmark.definition.id} topology did not preserve rerasterized material removal`);
  }
  const meshArtifact = solved.artifacts.find(({ kind }) => kind === "manufacturing-mesh");
  if (!meshArtifact) throw new Error(`${benchmark.definition.id} topology omitted its manufacturing mesh artifact`);
  const reboundMeshArtifact = await createTopologyMeshArtifact(
    benchmark.topologyRequest, output.manufacturingMesh,
  );
  if (reboundMeshArtifact.record.id !== meshArtifact.id) {
    throw new Error(`${benchmark.definition.id} topology mesh bytes do not match the committed artifact`);
  }
  const study = benchmark.topologyRequest.document.studies
    .find(({ id }) => id === benchmark.topologyRequest!.studyId);
  const sourceStudy = study?.kind === "topology"
    ? benchmark.topologyRequest.document.studies.find(({ id }) => id === study.sourceStudyId)
    : undefined;
  const material = sourceStudy?.kind === "structural-linear"
    ? benchmark.topologyRequest.document.materials.find(({ id }) => id === sourceStudy.materialId)
    : undefined;
  if (study?.kind !== "topology" || study.configurationState !== "configured"
    || !material || material.kind !== "isotropic"
    || !(output.postExtractionAnalysis.maximumVonMisesStressPa > 0)) {
    throw new Error(`${benchmark.definition.id} topology acceptance binding is incomplete`);
  }
  const evidence = {
    exactBrepArtifactId: benchmark.exactBrepArtifact.id,
    semanticMeshArtifactId: benchmark.semanticMeshArtifact.id,
    voxelArtifactId: benchmark.structuralRequest.input.voxelArtifactId,
    manufacturingMeshArtifactId: meshArtifact.id,
    rerasterizedVoxelArtifactId: output.rerasterizedVoxelArtifact.id,
    bindingDigest: await revisionId({
      documentRevision: benchmark.topologyRequest.document.revision,
      studyId: benchmark.topologyRequest.studyId,
      namedSelections: benchmark.topologyRequest.document.namedSelections,
      artifacts: benchmark.topologyRequest.inputArtifacts.map(({ id }) => id),
    }),
    grid: {
      dimensions: [...output.postExtractionAnalysis.grid.cellDimensions] as [number, number, number],
      activeCells: initialActiveCells, cellSizeM: output.postExtractionAnalysis.grid.cellSizeM,
    },
    objectiveHistoryJ: [...output.objectiveHistory], materialFraction: output.materialFraction,
    targetVolumeFraction: benchmark.definition.topologyTarget,
    initialActiveCells, finalActiveCells, rerasterMatchesFinalMask: true as const,
    extraction: {
      closed: true as const, oriented: true as const,
      requiredInterfacesConnected: true as const, protectedVoidsClear: true as const,
      minimumFeatureSatisfied: true as const,
    }, postAnalysis: numerical(output.postExtractionAnalysis),
    configuredLimits: {
      ...study.acceptance,
      measuredSafetyFactor: material.failureStressPa
        / output.postExtractionAnalysis.maximumVonMisesStressPa,
    },
    auditDecision: { eligible: true as const, accepted: false as const, exportable: false as const },
    timingMs: now() - started,
  };
  return { evidence, mesh: output.manufacturingMesh, request: benchmark.topologyRequest };
}
async function cancellationCase(benchmark: ExactBrowserBenchmark, audit: GateGpuAudit) {
  const runtime = runnerFor(benchmark.structuralRequest.document, audit);
  const { runner } = runtime, started = now();
  const request = { ...benchmark.structuralRequest, jobId: "live-cancellation-probe" };
  let cancelled = false;
  const unsubscribe = runner.subscribe(({ event }) => {
    if (event.jobId === request.jobId && event.state === "partial"
      && event.progress > .05 && !cancelled) {
      cancelled = runner.cancel(request.jobId);
    }
  });
  const completion = await runner.launch<StructuralSolveInput, StructuralResult>(request).completion;
  unsubscribe();
  if (!cancelled || completion.event.state !== "cancelled") {
    throw new Error("Live structural cancellation did not terminate as cancelled");
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const cancelledTerminals = runner.entries().filter(({ event }) => event.jobId === request.jobId
    && ["verified", "failed", "cancelled"].includes(event.state));
  if (cancelledTerminals.length !== 1 || runtime.committedIds.size !== 0) {
    throw new Error("Cancelled structural run emitted a late terminal or committed artifacts");
  }
  const recovery = await runner.launch<StructuralSolveInput, StructuralResult>({
    ...benchmark.structuralRequest, jobId: "live-cancellation-recovery",
  }).completion;
  if (recovery.event.state !== "verified") throw new Error("Fresh structural run did not recover after cancellation");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const terminals = runner.entries().filter(({ event }) => event.jobId === request.jobId
    && ["verified", "failed", "cancelled"].includes(event.state));
  if (terminals.length !== 1) {
    throw new Error("Cancelled structural run emitted a late terminal or committed artifacts");
  }
  return {
    outcome: "cancelled" as const, lateTerminal: false as const,
    artifactsCommitted: 0 as const,
    recoveryRunPassed: true as const, timingMs: now() - started,
  };
}
export async function runStructuralTopologyBrowserGate(
  signal: AbortSignal = new AbortController().signal,
  capture?: (candidates: GateTopologyCandidates) => void,
): Promise<StructuralTopologyGateReport> {
  const lines: string[] = [], started = now(), audit = createGateGpuAudit();
  const consoleAudit = createGateConsoleAudit();
  let stage = "exact-cad-benchmarks";
  const status = (line: string) => { lines.push(line); console.info(`[structural-topology-gate] ${line}`); };
  try {
    const benchmarks = new Map<BrowserBenchmarkId, ExactBrowserBenchmark>();
    for (const definition of BROWSER_BENCHMARKS) {
      benchmarks.set(definition.id, await buildExactBrowserBenchmark(definition, signal));
      status(`${definition.id} exact BREP, semantic mesh, and voxel domain built`);
    }
    stage = "structural-solves";
    const axial = await structuralCase(benchmarks.get("axial")!, audit);
    const cantilever = await structuralCase(benchmarks.get("cantilever")!, audit);
    status("Axial and cantilever analytical/Wasm gates passed");
    stage = "topology-solves";
    const drone = await topologyCase(benchmarks.get("drone")!, audit);
    const cobot = await topologyCase(benchmarks.get("cobot")!, audit);
    status("Distinct drone and cobot topology/re-analysis gates passed");
    stage = "cancellation";
    const cancellation = await cancellationCase(benchmarks.get("cantilever")!, audit);
    status("In-flight cancellation and fresh-worker recovery passed");
    await Promise.resolve();
    const recordedAt = new Date().toISOString();
    const content = {
      status: "passed" as const, evidenceSource: "live-browser-webgpu" as const,
      realGpu: true as const, auditOnly: true as const,
      recordedAt, device: audit.evidence(),
      thresholds: {
        relativeResidual: STRUCTURAL_RESIDUAL_TOLERANCE,
        relativeForceBalance: STRUCTURAL_FORCE_BALANCE_TOLERANCE,
        wasmRelativeL2: STRUCTURAL_WASM_L2_TOLERANCE,
        axialRelativeError: STRUCTURAL_VERIFICATION_METADATA.thresholds.axialRelativeError,
        cantileverRelativeError: STRUCTURAL_VERIFICATION_METADATA.thresholds.cantileverRelativeError,
      } as const,
      structural: { axial, cantilever },
      topology: { drone: drone.evidence, cobot: cobot.evidence }, cancellation,
      gpuDiagnostics: audit.verifiedDiagnostics(), timingsMs: { total: now() - started },
      console: { statusLines: lines, ...consoleAudit.evidence() },
    };
    const report = { ...content, sessionId: await revisionId(content) } satisfies PassedReport;
    const parsed = parseStructuralTopologyGateReport(report);
    if (!await verifyStructuralTopologyGateReportDigest(parsed)) {
      throw new Error("Structural topology gate report seal did not verify");
    }
    capture?.({ drone, cobot });
    return parsed;
  } catch (error) {
    if (signal.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[structural-topology-gate] ${stage}: ${message}`);
    const report = parseStructuralTopologyGateReport({
      status: "blocked", evidenceSource: "live-browser-webgpu",
      blocker: { stage, message }, console: { statusLines: lines, ...consoleAudit.evidence() },
    });
    return report;
  } finally {
    consoleAudit.restore();
  }
}
