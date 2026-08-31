import { describe, expect, it } from "vitest";

import { prepareSolverRunResult } from "../../engineering/job-runner-result";
import { compileStructuralStudy } from "./compile-structural-study";
import {
  STRUCTURAL_RESULT_MEDIA_TYPE,
  STRUCTURAL_VERIFICATION_METADATA,
  type StructuralResult,
} from "./structural-contract";
import { packInteractiveStructuralRunResult } from "./structural-result-artifacts";
import { structuralRequest } from "./structural-test-fixtures";

describe("structural result artifacts", () => {
  it("packs interactive fields with complete ownership and locked verification metadata", async () => {
    const { request, result, system } = await validFixture();
    const envelope = await packInteractiveStructuralRunResult(request, system, result);
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

  it("rejects every caller-supplied converged truth claim before Task 5", async () => {
    const { request, result, system } = await validFixture();

    await expect(packInteractiveStructuralRunResult(request, system, {
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

    await expect(packInteractiveStructuralRunResult(request, system, {
      ...result,
      verification: { ...result.verification, forceBalanceErrorN: 0.1 },
    })).resolves.toMatchObject({ truthLevel: "interactive-estimate" });
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
    ["iteration ceiling", (value: StructuralResult) => ({ ...value, iterations: 513 }), /iterations/i],
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
      ...value, verification: { ...value.verification, forceBalanceErrorN: 1 },
    }), /force balance.*threshold/i],
    ["applied load consistency", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, appliedLoadN: 900 },
    }), /applied load.*study/i],
    ["Wasm agreement threshold", (value: StructuralResult) => ({
      ...value, verification: { ...value.verification, wasmRelativeL2: 1e-2 },
    }), /Wasm.*threshold/i],
  ])("rejects incoherent %s evidence", async (_label, mutate, message) => {
    const { request, result, system } = await validFixture();
    await expect(packInteractiveStructuralRunResult(request, system, mutate(result))).rejects.toThrow(message);
  });
});

async function validFixture() {
  const request = await structuralRequest();
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
      relativeResidual: 1e-6, forceBalanceErrorN: 1e-6, appliedLoadN: 1000,
      wasmRelativeL2: 1e-4, realGpu: true,
      metadata: STRUCTURAL_VERIFICATION_METADATA,
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
