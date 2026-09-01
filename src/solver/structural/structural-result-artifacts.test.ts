import { describe, expect, it } from "vitest";

import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { prepareSolverRunResult } from "../../engineering/job-runner-result";
import { compileStructuralStudy } from "./compile-structural-study";
import {
  COMPONENT_STRUCTURAL_PCG_ITERATION_BUDGET,
  STRUCTURAL_RESULT_MEDIA_TYPE,
  structuralVerificationMetadata,
  type CompiledStructuralSystem,
  type StructuralResult,
} from "./structural-contract";
import { packInteractiveStructuralRunResult } from "./structural-result-artifacts";
import { structuralRequest } from "./structural-test-fixtures";

describe("structural result artifacts", () => {
  it("packs interactive fields with complete ownership and locked verification metadata", async () => {
    const { request, result, system } = await validFixture();
    const envelope = await packInteractiveStructuralRunResult(request, result);
    const prepared = await prepareSolverRunResult(request, envelope);

    expect(envelope.artifacts).toHaveLength(3);
    const requiredEntities = [
      "study:bar-static", "material:steel", "body:bar",
      "named-selection:fixed-end", "named-selection:loaded-end",
    ];
    for (const { record } of prepared.artifacts) {
      const entities = record.dependencies.flatMap((dependency) =>
        dependency.kind === "entity" ? [dependency.reference] : []);
      const artifacts = record.dependencies.flatMap((dependency) =>
        dependency.kind === "artifact" ? [dependency.artifactId] : []);
      expect(entities).toEqual(expect.arrayContaining(requiredEntities));
      expect(artifacts).toEqual(expect.arrayContaining([
        request.input.semanticMeshArtifactId, request.input.voxelArtifactId,
      ]));
    }
    expect(prepared.truthLevel).toBe("interactive-estimate");
    expect(summaryVerification(envelope)).toMatchObject({
      truthLevel: "interactive-estimate",
      metadata: {
        referenceSolver: "rust-wasm-hex8-f64",
        residualMethod: "webgpu-f32-pcg-recurrence",
        fixtureCellDimensions: { axial: [20, 2, 2], cantilever: [24, 4, 2] },
        maxIterations: 512,
        thresholds: {
          relativeResidual: 1e-5, relativeForceBalance: 1e-4, wasmRelativeL2: 2e-3,
          axialRelativeError: 0.02, cantileverRelativeError: 0.05,
          energyRelativeMismatch: 1e-5,
        },
      },
    });
  });

  it("binds generic and component iteration budgets into evidence and artifact identity", async () => {
    const generic = await validFixture();
    const component = await validFixture({
      pcgIterationBudget: COMPONENT_STRUCTURAL_PCG_ITERATION_BUDGET,
    });
    const genericEnvelope = await packInteractiveStructuralRunResult(generic.request, generic.result);
    const componentEnvelope = await packInteractiveStructuralRunResult(component.request, component.result);

    expect(summaryVerification(genericEnvelope)).toMatchObject({
      metadata: { maxIterations: 512, maxTotalIterations: 2_048 },
    });
    expect(summaryVerification(componentEnvelope)).toMatchObject({
      metadata: { maxIterations: 1_024, maxTotalIterations: 4_096 },
    });
    expect(new Set(genericEnvelope.artifacts.map(({ record }) => record.settingsDigest)).size).toBe(1);
    expect(new Set(componentEnvelope.artifacts.map(({ record }) => record.settingsDigest)).size).toBe(1);
    expect(genericEnvelope.artifacts[0].record.settingsDigest)
      .not.toBe(componentEnvelope.artifacts[0].record.settingsDigest);
  });

  it("rejects every caller-supplied converged truth claim before Task 5", async () => {
    const { request, result, system } = await validFixture();

    await expect(packInteractiveStructuralRunResult(request, {
      ...result,
      truthLevel: "converged-numerical-solve",
      verification: {
        ...result.verification,
        numericalGatesPassed: true,
        analyticalRelativeError: 0,
        passed: true,
      } as unknown as StructuralResult["verification"],
    })).rejects.toThrow(/Task 5.*converged/i);
  });

  it("accepts numerical evidence exactly on the locked force-balance boundary", async () => {
    const { request, result, system } = await validFixture();

    await expect(packInteractiveStructuralRunResult(request, {
      ...result,
      verification: {
        ...result.verification, gpuReactionBalanceErrorN: 100,
        wasmForceBalanceErrorN: 0.1,
        refinementPasses: result.verification.refinementPasses.map((pass, index, passes) =>
          index === passes.length - 1 ? { ...pass, postBalance: 0.1 } : pass),
      },
    })).resolves.toMatchObject({ truthLevel: "interactive-estimate" });
  });

  it.each([
    ["grid", (system: CompiledStructuralSystem, result: StructuralResult) => {
      const grid = { ...system.grid, cellSizeM: 0.02 };
      return { system: { ...system, grid }, result: { ...result, grid } };
    }],
    ["active cells", (system: CompiledStructuralSystem, result: StructuralResult) => {
      const activeCells = new Uint32Array(system.activeCells); activeCells[0] = 0;
      return { system: { ...system, activeCells, activeCellCount: 15 }, result };
    }],
    ["boundary conditions", (system: CompiledStructuralSystem, result: StructuralResult) => {
      const fixedDofs = new Uint32Array(system.fixedDofs); fixedDofs[0] = 0;
      return { system: { ...system, fixedDofs }, result };
    }],
    ["loads", (system: CompiledStructuralSystem, result: StructuralResult) => ({
      system: { ...system, loadsN: new Float32Array(system.loadsN.length) }, result,
    })],
    ["material", (system: CompiledStructuralSystem, result: StructuralResult) => ({
      system: { ...system, material: { ...system.material, youngsModulusPa: 100e9 } }, result,
    })],
    ["rasterization", (system: CompiledStructuralSystem, result: StructuralResult) => {
      const rasterization = { ...system.rasterization, toleranceM: 2e-6 };
      return { system: { ...system, rasterization }, result: { ...result, rasterization } };
    }],
  ] as const)("rejects legacy caller-supplied %s system authority", async (_label, forge) => {
    const { request, result, system } = await validFixture();
    const forged = forge(system, result);
    type LegacyPacker = (
      solveRequest: typeof request, system: CompiledStructuralSystem, result: StructuralResult,
    ) => ReturnType<typeof packInteractiveStructuralRunResult>;
    const legacyPack = packInteractiveStructuralRunResult as unknown as LegacyPacker;

    await expect(legacyPack(request, forged.system, forged.result)).rejects.toThrow();
  });

  it.each([
    ["displacement field length", (value: StructuralResult) => ({ ...value, displacementM: new Float32Array(1) }), /displacement.*length/i],
    ["finite displacement", (value: StructuralResult) => {
      const field = new Float32Array(value.displacementM); field[0] = Number.NaN;
      return { ...value, displacementM: field };
    }, /displacement.*finite/i],
    ["nonnegative stress", (value: StructuralResult) => {
      const field = new Float32Array(value.vonMisesStressPa); field[0] = -1;
      return { ...value, vonMisesStressPa: field };
    }, /stress.*nonnegative/i],
    ["grid consistency", (value: StructuralResult) => ({
      ...value, grid: { ...value.grid, nodeDimensions: [6, 3, 3] as const },
    }), /grid.*compiled system/i],
    ["iteration ceiling", (value: StructuralResult) => ({ ...value, iterations: 2049 }), /iterations/i],
    ["finite metrics", (value: StructuralResult) => ({ ...value, complianceJ: Number.NaN }), /metrics.*finite/i],
    ["energy relation", (value: StructuralResult) => ({ ...value, strainEnergyJ: 0.006 }), /energy.*compliance/i],
    ["field maximum", (value: StructuralResult) => ({ ...value, maximumDisplacementM: 2e-6 }), /maximum displacement/i],
    ["residual threshold", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, relativeResidual: 1e-2 },
    }), /residual.*threshold/i],
    ["finite numerical evidence", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, relativeResidual: Number.NaN },
    }), /numerical evidence.*finite/i],
    ["force balance threshold", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, wasmForceBalanceErrorN: 1 },
    }), /force balance.*threshold/i],
    ["applied load consistency", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, appliedLoadN: 900 },
    }), /applied load.*study/i],
    ["Wasm agreement threshold", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, wasmRelativeL2: 1e-2 },
    }), /Wasm.*threshold/i],
    ["Wasm field stress threshold", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, wasmFieldStressRelativeL2: 1e-2 },
    }), /field-stress.*threshold/i],
    ["field energy threshold", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, energyRelativeMismatch: 1e-2 },
    }), /field energy.*threshold/i],
    ["refinement pass residual", (value: StructuralResult) => ({
      ...value, verification: {
        ...value.verification,
        refinementPasses: value.verification.refinementPasses.map((pass) => ({
          ...pass, recursiveResidual: 1e-2,
        })),
      },
    }), /refinement pass.*threshold/i],
    ["refinement pass count", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, refinementCount: 1 },
    }), /refinement pass count/i],
  ])("rejects incoherent %s evidence", async (_label, mutate, message) => {
    const { request, result, system } = await validFixture();
    await expect(packInteractiveStructuralRunResult(request, mutate(result))).rejects.toThrow(message);
  });
});

async function validFixture(settings: Record<string, number> = {}) {
  const baseRequest = await structuralRequest();
  const request = await defineEngineeringSolveRequest<typeof baseRequest.input>({
    ...baseRequest, settings,
  });
  const system = await compileStructuralStudy(request);
  const displacementM = new Float32Array(system.fixedDofs.length);
  displacementM[3] = 1e-6;
  const vonMisesStressPa = new Float32Array(system.activeCells.length);
  vonMisesStressPa[0] = 2e6;
  const result: StructuralResult = {
    truthLevel: "interactive-estimate", grid: system.grid,
    iterations: 12, complianceJ: 0.01, strainEnergyJ: 0.005,
    maximumDisplacementM: Math.hypot(displacementM[3]!), maximumVonMisesStressPa: 2e6,
    verification: {
      relativeResidual: 1e-6, recomputedF32RelativeResidual: 1e-4,
      gpuReactionBalanceErrorN: .1, wasmForceBalanceErrorN: 1e-6,
      wasmReactionN: [-1000, 0, 0], appliedLoadN: 1000,
      wasmRelativeL2: 1e-4, wasmFieldStressRelativeL2: 1e-4,
      energyRelativeMismatch: 0, directRelativeResidual: 1e-4,
      refinementCount: 0, refinementPasses: [{
        kind: "initial", iterations: 12, recursiveResidual: 1e-6,
        recomputedF32Residual: 1e-4, residualScaleN: 1000,
        postDirectResidual: 1e-4, postBalance: 1e-6, postEnergy: 0,
      }], realGpu: true,
      metadata: structuralVerificationMetadata(settings),
    },
    rasterization: system.rasterization, displacementM, vonMisesStressPa,
  };
  return { request, result, system };
}

function summaryVerification(
  envelope: Awaited<ReturnType<typeof packInteractiveStructuralRunResult>>,
): Record<string, unknown> {
  const artifact = envelope.artifacts.find(({ record }) => record.mediaType === STRUCTURAL_RESULT_MEDIA_TYPE);
  const payload = artifact?.payload as { verificationUtf8?: Uint8Array } | undefined;
  if (!payload?.verificationUtf8) throw new Error("Structural summary verification payload is missing");
  return JSON.parse(new TextDecoder().decode(payload.verificationUtf8)) as Record<string, unknown>;
}
