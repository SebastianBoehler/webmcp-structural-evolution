import { defineArtifactRecord, type ArtifactRecord } from "../../cad/artifact-contract";
import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { digestArtifactPayload, type ArtifactPayload } from "../../engineering/artifact-store";
import type { EngineeringSolveRequest, SolverGeneratedArtifact, SolverRunResult } from "../../engineering/solver-adapter";
import { revisionId } from "../../domain/revisions";
import type {
  StructuralResult, StructuralSolveInput, StructuralVoxelPayload,
} from "../structural/structural-contract";
import { decideTopologyAcceptance } from "./topology-acceptance";
import {
  TOPOLOGY_DECISION_MEDIA_TYPE,
  TOPOLOGY_DENSITY_MEDIA_TYPE,
  TOPOLOGY_MESH_MEDIA_TYPE,
  type TopologyAcceptanceDecision,
  type TopologyExtractionValidation,
  type TopologyMesh,
  type TopologyObjectiveSample,
  type TopologyResult,
  type TopologySolveInput,
} from "./topology-contract";
import { canonicalTopologyEvidence, validateTopologyPostAnalysis } from "./topology-evidence";

type Request = EngineeringSolveRequest<TopologySolveInput>;

function ownedBytes(source: ArrayBufferView): Uint8Array {
  const buffer = new ArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  return new Uint8Array(buffer);
}
const utf8 = (value: unknown) => ownedBytes(new TextEncoder().encode(JSON.stringify(value)));
const f32 = (source: ArrayLike<number>) => {
  const output = new Float32Array(new ArrayBuffer(source.length * Float32Array.BYTES_PER_ELEMENT));
  output.set(source); return output;
};
const f64 = (source: ArrayLike<number>) => {
  const output = new Float64Array(new ArrayBuffer(source.length * Float64Array.BYTES_PER_ELEMENT));
  output.set(source); return output;
};
const u32 = (source: ArrayLike<number>) => {
  const output = new Uint32Array(new ArrayBuffer(source.length * Uint32Array.BYTES_PER_ELEMENT));
  output.set(source); return output;
};

async function generated(
  request: Request,
  kind: ArtifactRecord["kind"],
  mediaType: string,
  payload: ArtifactPayload,
  label: string,
  dependencies: ArtifactRecord["dependencies"],
): Promise<SolverGeneratedArtifact> {
  const record = await defineArtifactRecord({
    kind, sourceRevision: request.sourceRevision,
    producer: { name: "webgpu-discrete-topology", version: "1.0.0" },
    settingsDigest: await revisionId({ label, studyId: request.studyId }),
    contentDigest: await digestArtifactPayload(payload), units: "m", mediaType, dependencies,
  });
  return { record, payload };
}

function baseDependencies(request: Request): ArtifactRecord["dependencies"] {
  return [
    { kind: "entity", reference: `study:${request.studyId}` },
    ...request.inputArtifacts.map(({ id }) => ({ kind: "artifact" as const, artifactId: id })),
  ];
}

export async function createTopologyMeshArtifact(
  request: Request,
  mesh: TopologyMesh,
): Promise<SolverGeneratedArtifact> {
  return generated(request, "manufacturing-mesh", TOPOLOGY_MESH_MEDIA_TYPE, {
    positionsM: f32(mesh.positionsM),
    triangles: u32(mesh.triangles),
    extraction: f64([mesh.isoValue, mesh.toleranceM]),
  }, "extracted-manufacturing-mesh", baseDependencies(request));
}

async function packValidatedTopologyBundle(input: Readonly<{
  request: Request;
  density: Float32Array;
  samples: readonly TopologyObjectiveSample[];
  binaryMasks: readonly Uint8Array[];
  meshArtifact: SolverGeneratedArtifact;
  mesh: TopologyMesh;
  rerasterizedVoxel: ArtifactRecord;
  rerasterizedPayload: StructuralVoxelPayload;
  postAnalysis: StructuralResult;
  extraction: TopologyExtractionValidation;
  acceptance: TopologyAcceptanceDecision;
  materialFraction: number;
}>): Promise<SolverRunResult<TopologyResult>> {
  if (input.binaryMasks.length !== input.samples.length || input.binaryMasks.some(
    (mask) => mask.length !== input.density.length || mask.some((value) => value !== 0 && value !== 1),
  )) throw new Error("Topology mask history is not aligned with its objective samples");
  const binaryMasks = new Uint8Array(input.binaryMasks.length * input.density.length);
  input.binaryMasks.forEach((mask, index) => binaryMasks.set(mask, index * input.density.length));
  const history = await generated(input.request, "field", TOPOLOGY_DENSITY_MEDIA_TYPE, {
    density: f32(input.density),
    objectivesJ: f64(input.samples.map(({ objectiveJ }) => objectiveJ)),
    samplesUtf8: utf8(input.samples),
    binaryMasks: ownedBytes(binaryMasks),
    maskShape: u32([input.binaryMasks.length, input.density.length]),
  }, "density-history", baseDependencies(input.request));
  const fieldDependencies: ArtifactRecord["dependencies"] = [
    { kind: "entity", reference: `study:${input.request.studyId}` },
    { kind: "artifact", artifactId: input.request.input.sourceStructuralRequest.input.semanticMeshArtifactId },
    { kind: "artifact", artifactId: input.rerasterizedVoxel.id },
  ];
  const displacement = await generated(input.request, "field",
    "application/vnd.structural-evolution.structural-field-v1; quantity=displacement",
    { displacementM: f32(input.postAnalysis.displacementM) },
    "post-extraction-displacement", fieldDependencies);
  const stress = await generated(input.request, "field",
    "application/vnd.structural-evolution.structural-field-v1; quantity=von-mises-stress",
    { vonMisesStressPa: f32(input.postAnalysis.vonMisesStressPa) },
    "post-extraction-stress", fieldDependencies);
  const decisionDependencies: ArtifactRecord["dependencies"] = [
    { kind: "entity", reference: `study:${input.request.studyId}` },
    ...[
    history.record, input.meshArtifact.record, input.rerasterizedVoxel, displacement.record, stress.record,
    ].map(({ id }) => ({ kind: "artifact" as const, artifactId: id })),
  ];
  const decision = await generated(input.request, "field", TOPOLOGY_DECISION_MEDIA_TYPE, {
    decisionUtf8: utf8({
      acceptance: input.acceptance, extraction: input.extraction,
      objectiveSamples: input.samples,
      postAnalysis: {
        truthLevel: input.postAnalysis.truthLevel,
        complianceJ: input.postAnalysis.complianceJ,
        maximumDisplacementM: input.postAnalysis.maximumDisplacementM,
        maximumVonMisesStressPa: input.postAnalysis.maximumVonMisesStressPa,
        verification: input.postAnalysis.verification,
      },
    }),
  }, "decision-manifest", decisionDependencies);
  return {
    truthLevel: "interactive-estimate",
    output: {
      truthLevel: "interactive-estimate", density: new Float32Array(input.density),
      objectiveHistory: input.samples.map(({ objectiveJ }) => objectiveJ),
      objectiveSamples: [...input.samples], materialFraction: input.materialFraction,
      manufacturingMesh: input.mesh, extraction: input.extraction,
      rerasterizedVoxelArtifact: input.rerasterizedVoxel,
      postExtractionAnalysis: input.postAnalysis, acceptance: input.acceptance,
    },
    artifacts: [
      history, input.meshArtifact,
      { record: input.rerasterizedVoxel, payload: input.rerasterizedPayload },
      displacement, stress, decision,
    ],
  };
}

export async function packInteractiveTopologyRunResult(input: Readonly<{
  request: Request;
  density: Float32Array;
  binaryMasks: readonly Uint8Array[];
  analyses: readonly StructuralResult[];
  postAnalysis: StructuralResult;
}>): Promise<SolverRunResult<TopologyResult>> {
  const outer = await defineEngineeringSolveRequest<TopologySolveInput>(input.request);
  const source = await defineEngineeringSolveRequest<StructuralSolveInput>(
    outer.input.sourceStructuralRequest,
  );
  const request: Request = {
    ...outer,
    input: {
      sourceStructuralRequest: source,
      initialDensity: new Float32Array(outer.input.initialDensity),
    },
  };
  const canonical = await canonicalTopologyEvidence({ ...input, request });
  const meshArtifact = await createTopologyMeshArtifact(request, canonical.mesh);
  const post = await validateTopologyPostAnalysis(
    request, meshArtifact.record, canonical.rerasterized, input.postAnalysis,
  );
  const materialFraction = canonical.rerasterized.reduce((sum, value) => sum + value, 0)
    / canonical.system.activeCellCount;
  const acceptance = decideTopologyAcceptance({
    objectiveHistory: canonical.samples.map(({ objectiveJ }) => objectiveJ), materialFraction,
    structuralSettings: source.settings,
    analysis: input.postAnalysis, extraction: canonical.extraction,
    constraints: canonical.study.acceptance,
    failureStressPa: canonical.system.material.failureStressPa,
  });
  return packValidatedTopologyBundle({
    request, density: input.density,
    samples: canonical.samples, binaryMasks: input.binaryMasks,
    meshArtifact, mesh: canonical.mesh,
    rerasterizedVoxel: post.voxelArtifact,
    rerasterizedPayload: post.request.input.voxelPayload,
    postAnalysis: input.postAnalysis, extraction: canonical.extraction, acceptance, materialFraction,
  });
}
