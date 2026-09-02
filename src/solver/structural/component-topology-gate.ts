import { droneMotorSideArmDocument } from "../../models/component-documents";
import { runComponentStudy } from "../../workspace/component-showcase-runtime";
import { createWebGpuTopologyAdapter } from "../topology/topology-adapter";
import type { TopologyResult, TopologySolveInput } from "../topology/topology-contract";
import { topologyMask } from "../topology/density-constraints";
import { createGateGpuAudit } from "./browser-gpu-audit";

const STUDY_ID = "drone-arm-topology";
const TARGET_VOLUME_FRACTION = 0.35;

export type ComponentTopologyGateReport = Readonly<{
  status: "passed";
  evidenceSource: "live-browser-webgpu";
  scope: "audit-only";
  studyId: typeof STUDY_ID;
  targetVolumeFraction: typeof TARGET_VOLUME_FRACTION;
  sourceRevision: string;
  timingMs: number;
  result: Readonly<{
    truthLevel: TopologyResult["truthLevel"];
    materialCount: number;
    domainCount: number;
    materialFraction: number;
    objectiveHistoryJ: readonly number[];
    extraction: TopologyResult["extraction"];
    acceptance: TopologyResult["acceptance"];
    postExtractionAnalysis: Readonly<{
      iterations: number;
      relativeResidual: number;
      recomputedF32RelativeResidual: number;
      wasmForceBalanceErrorN: number;
      energyRelativeMismatch: number;
      maximumDisplacementM: number;
      maximumVonMisesStressPa: number;
    }>;
    artifactIds: readonly string[];
  }>;
  device: ReturnType<ReturnType<typeof createGateGpuAudit>["evidence"]>;
  gpuDiagnostics: ReturnType<ReturnType<typeof createGateGpuAudit>["verifiedDiagnostics"]>;
}> | Readonly<{
  status: "blocked";
  evidenceSource: "live-browser-webgpu";
  scope: "audit-only";
  stage: string;
  message: string;
  timingMs: number;
}>;

export async function runComponentTopologyGate(
  signal: AbortSignal,
): Promise<ComponentTopologyGateReport> {
  const started = performance.now(), audit = createGateGpuAudit();
  let stage = "component-document";
  try {
    const model = await droneMotorSideArmDocument();
    const study = model.document.studies.find(({ id }) => id === STUDY_ID);
    if (!study || study.kind !== "topology" || study.configurationState !== "configured") {
      throw new Error("drone-arm-topology is not a configured component topology study");
    }
    if (study.targetVolumeFraction !== TARGET_VOLUME_FRACTION) {
      throw new Error(`drone-arm-topology target changed to ${study.targetVolumeFraction}`);
    }
    stage = "topology-solve";
    const run = await runComponentStudy<TopologySolveInput, TopologyResult>(
      model, STUDY_ID, createWebGpuTopologyAdapter({ onAcquisition: audit.observe }), signal,
    );
    const output = run.result.output;
    if (output.truthLevel !== "interactive-estimate"
      || output.postExtractionAnalysis.verification.realGpu !== true) {
      throw new Error("drone-arm-topology did not return a live WebGPU interactive estimate");
    }
    if (!output.acceptance.eligible || output.acceptance.reasons.length !== 0) {
      throw new Error(`drone-arm-topology is ineligible: ${output.acceptance.reasons.join(", ")}`);
    }
    if (output.acceptance.accepted !== false || output.acceptance.exportable !== false
      || output.acceptance.promotionRequired !== "task-5-live-gate") {
      throw new Error("drone-arm-topology omitted its required Task 5 promotion boundary");
    }
    if (Object.values(output.extraction).some((value) => value !== true)) {
      throw new Error("drone-arm-topology extraction evidence is incomplete");
    }
    const source = run.request.input.sourceStructuralRequest.input.voxelPayload;
    const domainCount = source.activeCells.reduce((sum, value) => sum + value, 0);
    const materialCount = topologyMask(
      output.density, output.manufacturingMesh.isoValue, source.activeCells,
    ).reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(domainCount) || domainCount <= 0
      || !Number.isSafeInteger(materialCount) || materialCount < 0
      || output.materialFraction !== materialCount / domainCount) {
      throw new Error("drone-arm-topology material-count evidence is incoherent");
    }
    if (run.artifactIds.length === 0 || new Set(run.artifactIds).size !== run.artifactIds.length
      || run.artifactIds.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new Error("drone-arm-topology artifact evidence is incomplete");
    }
    stage = "gpu-audit";
    const verification = output.postExtractionAnalysis.verification;
    return {
      status: "passed", evidenceSource: "live-browser-webgpu", scope: "audit-only",
      studyId: STUDY_ID, targetVolumeFraction: TARGET_VOLUME_FRACTION,
      sourceRevision: model.document.revision, timingMs: performance.now() - started,
      result: {
        truthLevel: output.truthLevel, materialCount, domainCount,
        materialFraction: output.materialFraction,
        objectiveHistoryJ: [...output.objectiveHistory], extraction: output.extraction,
        acceptance: output.acceptance, artifactIds: [...run.artifactIds],
        postExtractionAnalysis: {
          iterations: output.postExtractionAnalysis.iterations,
          relativeResidual: verification.relativeResidual,
          recomputedF32RelativeResidual: verification.recomputedF32RelativeResidual,
          wasmForceBalanceErrorN: verification.wasmForceBalanceErrorN,
          energyRelativeMismatch: verification.energyRelativeMismatch,
          maximumDisplacementM: output.postExtractionAnalysis.maximumDisplacementM,
          maximumVonMisesStressPa: output.postExtractionAnalysis.maximumVonMisesStressPa,
        },
      }, device: audit.evidence(), gpuDiagnostics: audit.verifiedDiagnostics(),
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: "blocked", evidenceSource: "live-browser-webgpu", scope: "audit-only",
      stage, message: error instanceof Error ? error.message : String(error),
      timingMs: performance.now() - started };
  }
}
