import { revisionId } from "../../domain/revisions";
import type { ArtifactRecord } from "../../cad/artifact-contract";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
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
import {
  parseStructuralTopologyGateReport, verifyStructuralTopologyGateReportDigest,
  type StructuralTopologyGateReport,
} from "./browser-gate-report";
import { createGateConsoleAudit, createGateGpuAudit } from "./browser-gpu-audit";
import { analyticalEvidence } from "./browser-gate-analytical";
import { buildComponentStructuralShowcases } from "./component-structural-showcase";
import type { ShowcaseModelEvidence } from "../../workspace/component-showcase-evidence";
import { runStructuralCancellationCase, solveGateRequest } from "./browser-gate-runtime";
type PassedReport = Extract<StructuralTopologyGateReport, { status: "passed" }>;
type TopologyEvidence = PassedReport["topology"]["cobot"];
export type GateTopologyCandidate = Readonly<{
  evidence: TopologyEvidence; mesh: TopologyMesh;
  request: EngineeringSolveRequest<TopologySolveInput>;
  model: ShowcaseModelEvidence;
}>;
export type GateTopologyCandidates = Readonly<{
  cobot: GateTopologyCandidate;
  models: Readonly<{ drone: ShowcaseModelEvidence; cobot: ShowcaseModelEvidence }>;
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
async function structuralCase(benchmark: ExactBrowserBenchmark, audit: GateGpuAudit) {
  const started = now();
  const solved = await solveGateRequest<StructuralSolveInput, StructuralResult>(benchmark.structuralRequest, audit.observe);
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
async function componentStructuralCase(
  benchmark: ExactBrowserBenchmark, result: StructuralResult, timingMs: number,
) {
  if (result.truthLevel !== "interactive-estimate" || result.verification.realGpu !== true) {
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
      dimensions: [...result.grid.cellDimensions] as [number, number, number],
      activeCells: benchmark.structuralRequest.input.voxelPayload.activeCells.reduce((sum, value) => sum + value, 0),
      cellSizeM: result.grid.cellSizeM,
    }, numerical: numerical(result), timingMs,
  };
}
async function topologyCase(
  benchmark: ExactBrowserBenchmark, audit: GateGpuAudit,
  precomputed?: Readonly<{ output: TopologyResult; artifacts: readonly ArtifactRecord[]; timingMs: number }>,
) {
  if (!benchmark.topologyRequest || benchmark.definition.topologyTarget === undefined) {
    throw new Error(`${benchmark.definition.id} topology request is unavailable`);
  }
  const started = now();
  const solved = precomputed ?? await solveGateRequest<TopologySolveInput, TopologyResult>(
    benchmark.topologyRequest, audit.observe,
  );
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
    timingMs: precomputed?.timingMs ?? now() - started,
  };
  return { evidence, mesh: output.manufacturingMesh, request: benchmark.topologyRequest };
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
    for (const definition of BROWSER_BENCHMARKS.filter(({ id }) => id === "axial" || id === "cantilever")) {
      benchmarks.set(definition.id, await buildExactBrowserBenchmark(definition, signal));
      status(`${definition.id} exact BREP, semantic mesh, and voxel domain built`);
    }
    const component = await buildComponentStructuralShowcases(signal, audit.observe);
    benchmarks.set("drone", component.drone.benchmark);
    benchmarks.set("cobot", component.cobot.benchmark);
    status("Drone motor-side and SE-6 upper-arm component workspaces planned");
    stage = "structural-solves";
    const axial = await structuralCase(benchmarks.get("axial")!, audit);
    const cantilever = await structuralCase(benchmarks.get("cantilever")!, audit);
    status("Axial and cantilever analytical/Wasm gates passed");
    const droneStructural = await componentStructuralCase(
      component.drone.benchmark, component.drone.structural.result, component.drone.structural.timingMs,
    );
    const cobotStructural = await componentStructuralCase(
      component.cobot.benchmark, component.cobot.structural.result, component.cobot.structural.timingMs,
    );
    status("Drone motor-side and SE-6 upper-arm component structural gates passed");
    stage = "topology-solves";
    if (!component.cobot.topology) throw new Error("SE-6 component topology result is unavailable");
    const cobot = await topologyCase(benchmarks.get("cobot")!, audit, {
      output: component.cobot.topology.result, artifacts: component.cobot.topology.artifacts,
      timingMs: component.cobot.topology.timingMs,
    });
    status("SE-6 upper-arm topology/re-analysis gate passed");
    stage = "cancellation";
    const cancellation = await runStructuralCancellationCase(benchmarks.get("cantilever")!, audit.observe);
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
      structural: { axial, cantilever, drone: droneStructural, cobot: cobotStructural },
      topology: { cobot: cobot.evidence }, cancellation,
      gpuDiagnostics: audit.verifiedDiagnostics(), timingsMs: { total: now() - started },
      console: { statusLines: lines, ...consoleAudit.evidence() },
    };
    const report = { ...content, sessionId: await revisionId(content) } satisfies PassedReport;
    const parsed = parseStructuralTopologyGateReport(report);
    if (!await verifyStructuralTopologyGateReportDigest(parsed)) {
      throw new Error("Structural topology gate report seal did not verify");
    }
    capture?.({ cobot: { ...cobot, model: component.cobot.model },
      models: { drone: component.drone.model, cobot: component.cobot.model } });
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
