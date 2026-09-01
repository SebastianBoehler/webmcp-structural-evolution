import { defineArtifactRecord, type ArtifactRecord } from "../../cad/artifact-contract";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import { digestArtifactPayload, type ArtifactPayload } from "../../engineering/artifact-store";
import { revisionId } from "../../domain/revisions";
import type { SolverRunResult } from "../../engineering/solver-adapter";
import { compileStructuralStudy } from "./compile-structural-study";
import {
  STRUCTURAL_FIELD_MEDIA_TYPE,
  STRUCTURAL_RESULT_MEDIA_TYPE,
  structuralPcgIterationBudget,
  type StructuralResult,
  type StructuralSolveInput,
} from "./structural-contract";
import { validateInteractiveStructuralResult } from "./structural-result-validation";

type Dependency = ArtifactRecord["dependencies"][number];

function utf8(value: unknown): Uint8Array {
  return Uint8Array.from(new TextEncoder().encode(JSON.stringify(value)));
}

function baseDependencies(
  request: EngineeringSolveRequest<StructuralSolveInput>,
): readonly Dependency[] {
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  if (!study || study.kind !== "structural-linear") throw new Error("Structural result study is unresolved");
  return [
    { kind: "entity", reference: `study:${study.id}` },
    { kind: "entity", reference: `material:${study.materialId}` },
    ...study.bodyIds.map((id) => ({ kind: "entity" as const, reference: `body:${id}` as const })),
    ...[...study.supports, ...study.loads.map(({ selectionId }) => selectionId)].map((id) => ({
      kind: "entity" as const, reference: `named-selection:${id}` as const,
    })),
    { kind: "artifact", artifactId: request.input.semanticMeshArtifactId },
    { kind: "artifact", artifactId: request.input.voxelArtifactId },
  ];
}

async function record(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  mediaType: string,
  payload: ArtifactPayload,
  settingsDigest: string,
  dependencies: readonly Dependency[],
): Promise<ArtifactRecord> {
  return defineArtifactRecord({
    kind: "field",
    sourceRevision: request.sourceRevision,
    producer: { name: "webgpu-hex8-elasticity", version: "1.0.0" },
    settingsDigest,
    contentDigest: await digestArtifactPayload(payload),
    units: "m",
    mediaType,
    dependencies,
  });
}

export async function packInteractiveStructuralRunResult(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  result: StructuralResult,
): Promise<SolverRunResult<StructuralResult>> {
  const system = await compileStructuralStudy(request);
  validateInteractiveStructuralResult(request, system, result);
  const base = baseDependencies(request);
  const settingsDigest = await revisionId({
    solver: "webgpu-hex8-elasticity-1.0.0",
    requestSettings: request.settings,
    pcgIterationBudget: structuralPcgIterationBudget(request.settings),
    grid: result.grid,
    rasterization: result.rasterization,
  });
  const displacementPayload = { displacementM: new Float32Array(result.displacementM) };
  const stressPayload = { vonMisesStressPa: new Float32Array(result.vonMisesStressPa) };
  const displacement = await record(
    request, `${STRUCTURAL_FIELD_MEDIA_TYPE}; quantity=displacement`,
    displacementPayload, settingsDigest, base,
  );
  const stress = await record(
    request, `${STRUCTURAL_FIELD_MEDIA_TYPE}; quantity=von-mises-stress`,
    stressPayload, settingsDigest, base,
  );
  const resultPayload = {
    metrics: new Float64Array([
      result.iterations, result.complianceJ, result.strainEnergyJ,
      result.maximumDisplacementM, result.maximumVonMisesStressPa,
      result.verification.relativeResidual, result.verification.gpuReactionBalanceErrorN,
      result.verification.recomputedF32RelativeResidual,
      result.verification.wasmForceBalanceErrorN, ...result.verification.wasmReactionN,
      result.verification.appliedLoadN, result.verification.wasmRelativeL2,
      result.verification.wasmFieldStressRelativeL2, result.verification.energyRelativeMismatch,
      result.verification.directRelativeResidual, result.verification.refinementCount,
    ]),
    grid: new Float64Array([
      ...result.grid.cellDimensions, ...result.grid.nodeDimensions,
      ...result.grid.originM, result.grid.cellSizeM,
    ]),
    rasterizationUtf8: utf8(result.rasterization),
    verificationUtf8: utf8({ truthLevel: result.truthLevel, ...result.verification }),
  };
  const summary = await record(request, STRUCTURAL_RESULT_MEDIA_TYPE, resultPayload, settingsDigest, [
    ...base,
    { kind: "artifact", artifactId: displacement.id },
    { kind: "artifact", artifactId: stress.id },
  ]);
  return {
    output: result,
    truthLevel: result.truthLevel,
    artifacts: [
      { record: displacement, payload: displacementPayload },
      { record: stress, payload: stressPayload },
      { record: summary, payload: resultPayload },
    ],
  };
}
