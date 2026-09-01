import type { ArtifactRecord } from "../../cad/artifact-contract";
import {
  droneMotorSideArmDocument, se6UpperArmDocument,
  type AuthoritativeComponentDocument,
} from "../../models/component-documents";
import { createWebGpuTopologyAdapter } from "../topology/topology-adapter";
import type { TopologyResult, TopologySolveInput } from "../topology/topology-contract";
import { componentShowcaseEvidence, type ShowcaseModelEvidence } from "../../workspace/component-showcase-evidence";
import { runComponentStudy } from "../../workspace/component-showcase-runtime";
import type { StructuralResult, StructuralSolveInput } from "./structural-contract";
import { createWebGpuStructuralAdapter } from "./webgpu-structural-adapter";
import type { BrowserBenchmarkId, ExactBrowserBenchmark } from "./browser-gate-exact-benchmark";
import type { StructuralGpuAcquisitionObserver } from "./structural-gpu-runtime";

export type ComponentStructuralShowcase = Readonly<{
  benchmark: ExactBrowserBenchmark;
  model: ShowcaseModelEvidence;
  structural: Readonly<{ result: StructuralResult; timingMs: number }>;
  topology?: Readonly<{
    result: TopologyResult; artifacts: readonly ArtifactRecord[]; timingMs: number;
  }>;
}>;

const studyAssignments = Object.freeze({
  drone: Object.freeze({ structuralStudyId: "drone-arm-structural" }),
  cobot: Object.freeze({ structuralStudyId: "se6-upper-arm-structural",
    topologyStudyId: "se6-upper-arm-topology" }),
});

export function componentStructuralStudyAssignments() {
  return studyAssignments;
}

function exactArtifact(request: ExactBrowserBenchmark["structuralRequest"], kind: "brep" | "render-mesh") {
  const artifact = request.inputArtifacts.find((candidate) => candidate.kind === kind);
  if (!artifact) throw new Error(`Component study omitted its exact ${kind} root`);
  return artifact as ArtifactRecord;
}

async function buildOne(
  model: AuthoritativeComponentDocument,
  id: Extract<BrowserBenchmarkId, "drone" | "cobot">,
  structuralStudyId: string,
  topologyStudyId: string | undefined,
  signal: AbortSignal,
  observe: StructuralGpuAcquisitionObserver,
): Promise<ComponentStructuralShowcase> {
  const structuralStarted = performance.now();
  const structural = await runComponentStudy<StructuralSolveInput, StructuralResult>(model, structuralStudyId,
    createWebGpuStructuralAdapter({ onAcquisition: observe }), signal);
  const structuralTimingMs = performance.now() - structuralStarted;
  const topologyStarted = performance.now();
  const topology = topologyStudyId === undefined ? undefined
    : await runComponentStudy<TopologySolveInput, TopologyResult>(model,
      topologyStudyId, createWebGpuTopologyAdapter({ onAcquisition: observe }), signal);
  const topologyTimingMs = performance.now() - topologyStarted;
  const study = topologyStudyId === undefined ? undefined
    : model.document.studies.find(({ id: candidate }) => candidate === topologyStudyId);
  if (topologyStudyId !== undefined
    && (!study || study.kind !== "topology" || study.configurationState !== "configured")) {
    throw new Error("Component topology study is not configured");
  }
  const structuralRequest = topology?.request.input.sourceStructuralRequest ?? structural.request;
  const sourceStudy = model.document.studies.find(({ id: candidate }) => candidate === structuralStudyId);
  if (!sourceStudy || sourceStudy.kind !== "structural-linear" || sourceStudy.loads.length !== 1) {
    throw new Error("Component structural study is unresolved");
  }
  const dimensions = structuralRequest.input.voxelPayload.dimensions;
  const cellSizeM = structuralRequest.input.voxelPayload.cellSizeM[0]!;
  const benchmark: ExactBrowserBenchmark = Object.freeze({
    definition: { id, sizeM: [dimensions[0]! * cellSizeM, dimensions[1]! * cellSizeM,
      dimensions[2]! * cellSizeM] as const, cellSizeM,
      forceN: [...sourceStudy.loads[0]!.forceN] as [number, number, number],
      ...(study?.kind === "topology" && study.configurationState === "configured"
        ? { topologyTarget: study.targetVolumeFraction,
        topologyAcceptance: study.acceptance } : {}) },
    structuralRequest, ...(topology ? { topologyRequest: topology.request } : {}),
    exactBrepArtifact: exactArtifact(structuralRequest, "brep"),
    semanticMeshArtifact: exactArtifact(structuralRequest, "render-mesh"),
  });
  return Object.freeze({ benchmark, model: componentShowcaseEvidence(model, "verified"),
    structural: { result: structural.result.output, timingMs: structuralTimingMs },
    ...(topology ? { topology: { result: topology.result.output,
      artifacts: topology.result.artifacts.map(({ record }) => record), timingMs: topologyTimingMs } } : {}) });
}

export async function buildComponentStructuralShowcases(
  signal: AbortSignal,
  observe: StructuralGpuAcquisitionObserver,
): Promise<Readonly<{ drone: ComponentStructuralShowcase; cobot: ComponentStructuralShowcase }>> {
  const [drone, cobot] = await Promise.all([droneMotorSideArmDocument(), se6UpperArmDocument()]);
  return {
    drone: await buildOne(drone, "drone", studyAssignments.drone.structuralStudyId,
      undefined, signal, observe),
    cobot: await buildOne(cobot, "cobot", studyAssignments.cobot.structuralStudyId,
      studyAssignments.cobot.topologyStudyId, signal, observe),
  };
}
