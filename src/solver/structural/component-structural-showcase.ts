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
}>;

function exactArtifact(request: ExactBrowserBenchmark["structuralRequest"], kind: "brep" | "render-mesh") {
  const artifact = request.inputArtifacts.find((candidate) => candidate.kind === kind);
  if (!artifact) throw new Error(`Component study omitted its exact ${kind} root`);
  return artifact as ArtifactRecord;
}

async function buildOne(
  model: AuthoritativeComponentDocument,
  id: Extract<BrowserBenchmarkId, "drone" | "cobot">,
  structuralStudyId: string,
  topologyStudyId: string,
  signal: AbortSignal,
  observe: StructuralGpuAcquisitionObserver,
): Promise<ComponentStructuralShowcase> {
  await runComponentStudy<StructuralSolveInput, StructuralResult>(model, structuralStudyId,
    createWebGpuStructuralAdapter({ onAcquisition: observe }), signal);
  const topology = await runComponentStudy<TopologySolveInput, TopologyResult>(model,
    topologyStudyId, createWebGpuTopologyAdapter({ onAcquisition: observe }), signal);
  const request = topology.request;
  const study = model.document.studies.find(({ id: candidate }) => candidate === topologyStudyId);
  if (!study || study.kind !== "topology" || study.configurationState !== "configured") {
    throw new Error("Component topology study is not configured");
  }
  const structuralRequest = request.input.sourceStructuralRequest;
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
      topologyTarget: study.targetVolumeFraction, topologyAcceptance: study.acceptance },
    structuralRequest, topologyRequest: request,
    exactBrepArtifact: exactArtifact(structuralRequest, "brep"),
    semanticMeshArtifact: exactArtifact(structuralRequest, "render-mesh"),
  });
  return Object.freeze({ benchmark, model: componentShowcaseEvidence(model, "verified") });
}

export async function buildComponentStructuralShowcases(
  signal: AbortSignal,
  observe: StructuralGpuAcquisitionObserver,
): Promise<Readonly<{ drone: ComponentStructuralShowcase; cobot: ComponentStructuralShowcase }>> {
  const [drone, cobot] = await Promise.all([droneMotorSideArmDocument(), se6UpperArmDocument()]);
  return {
    drone: await buildOne(drone, "drone", "drone-arm-structural", "drone-arm-topology", signal, observe),
    cobot: await buildOne(cobot, "cobot", "se6-upper-arm-structural", "se6-upper-arm-topology", signal, observe),
  };
}
