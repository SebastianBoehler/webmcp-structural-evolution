import { describe, expect, it } from "vitest";

import type { StructuralFieldEvaluation, StructuralIterateEvaluation } from "../../reference";
import { runMixedPrecisionRefinement } from "./mixed-precision-refinement";
import type { StructuralGpuSolve } from "./pcg";
import { StructuralGpuError } from "./structural-gpu-runtime";

function gpuPass(displacementM: readonly number[], residual = 5e-6, iterations = 7): StructuralGpuSolve {
  return {
    displacementM: Float32Array.from(displacementM), vonMisesStressPa: new Float32Array([1]),
    iterations, relativeResidual: residual, recomputedF32RelativeResidual: .02,
    forceBalanceErrorN: .02, complianceJ: 1,
  };
}

function candidate(balance: number, energy: number, direct: number): StructuralFieldEvaluation {
  return {
    reactionN: [-100, 0, 0], vonMisesStressPa: new Float32Array([3]),
    forceBalanceErrorN: balance, complianceJ: 1, strainEnergyJ: .5,
    energyRelativeMismatch: energy, directRelativeResidual: direct,
  };
}

function master(freeResidualN: readonly number[]): StructuralIterateEvaluation {
  return { freeResidualN: Float64Array.from(freeResidualN) };
}

function postprocess() {
  return Promise.resolve({
    vonMisesStressPa: new Float32Array([4]), recomputedF32RelativeResidual: .001,
    forceBalanceErrorN: .008, complianceJ: 2,
  });
}

const activeSignal = () => new AbortController().signal;

describe("mixed-precision structural refinement", () => {
  it("accumulates normalized GPU corrections in a Float64 master and records source-named passes", async () => {
    const solvedRhs: Float32Array[] = [];
    const evaluated: Float64Array[] = [];
    const candidates = [candidate(.02, 2e-5, .03), candidate(.005, 5e-6, .001)];
    let candidateIndex = 0;
    let postprocessed: Float32Array | undefined;
    const result = await runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100, 0, 0]), forceBalanceToleranceN: .01,
      signal: activeSignal(),
      solve: async (rhs) => {
        solvedRhs.push(new Float32Array(rhs));
        return solvedRhs.length === 1 ? gpuPass([.25, 0, 0]) : gpuPass([.125, -.25, 0]);
      },
      evaluateMaster: async (field) => { evaluated.push(new Float64Array(field)); return master([2, -1, 0]); },
      evaluateCandidate: async () => candidates[candidateIndex++]!,
      postprocess: async (field) => { postprocessed = new Float32Array(field); return postprocess(); },
    });

    expect([...solvedRhs[1]!]).toEqual([1, -.5, 0]);
    expect([...evaluated[0]!]).toEqual([.25, 0, 0]);
    expect([...postprocessed!]).toEqual([.5, -.5, 0]);
    expect(result).toMatchObject({ iterations: 14, refinementCount: 1 });
    expect(result.passes).toEqual([
      { kind: "initial", iterations: 7, recursiveResidual: 5e-6, recomputedF32Residual: .02,
        residualScaleN: 100, postDirectResidual: .03, postBalance: .02, postEnergy: 2e-5 },
      { kind: "correction", iterations: 7, recursiveResidual: 5e-6, recomputedF32Residual: .02,
        residualScaleN: 2, postDirectResidual: .001, postBalance: .005, postEnergy: 5e-6 },
    ]);
  });

  it("gates the rounded Float32 candidate rather than a hidden Float64 master", async () => {
    const rounded: Float32Array[] = [];
    let solves = 0;
    await expect(runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100]), forceBalanceToleranceN: .01, signal: activeSignal(),
      solve: async () => { solves += 1; return gpuPass(solves === 1 ? [0] : [.1]); },
      evaluateMaster: async () => master([.1]),
      evaluateCandidate: async (field) => {
        rounded.push(new Float32Array(field));
        return candidate(.02, 2e-5, .1);
      },
      postprocess,
    })).rejects.toThrow(/no improvement/i);
    expect(solves).toBe(2);
    expect(rounded[1]![0]).toBe(Math.fround(Math.fround(.1) * .1));
  });

  it("fails closed when any inner GPU recurrence misses the locked residual", async () => {
    await expect(runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100]), forceBalanceToleranceN: .01, signal: activeSignal(),
      solve: async () => gpuPass([0], 1.1e-5), evaluateMaster: async () => master([0]),
      evaluateCandidate: async () => candidate(0, 0, 0), postprocess,
    })).rejects.toMatchObject({ code: "diverged" });
  });

  it("rejects pass iteration evidence outside the per-pass bound", async () => {
    await expect(runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100]), forceBalanceToleranceN: .01, signal: activeSignal(),
      solve: async () => gpuPass([0], 1e-6, 513), evaluateMaster: async () => master([0]),
      evaluateCandidate: async () => candidate(0, 0, 0), postprocess,
    })).rejects.toMatchObject({ code: "diverged" });
  });

  it("detects Float32 precision stagnation before accepting an unchanged candidate", async () => {
    let candidateEvaluations = 0;
    await expect(runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100]), forceBalanceToleranceN: .01, signal: activeSignal(),
      solve: async (rhs) => rhs[0] === 100 ? gpuPass([1]) : gpuPass([1e-30]),
      evaluateMaster: async () => master([1e-30]),
      evaluateCandidate: async () => { candidateEvaluations += 1; return candidate(.02, 2e-5, .1); },
      postprocess,
    })).rejects.toThrow(/precision stagnation/i);
    expect(candidateEvaluations).toBe(1);
  });

  it("rejects a changed candidate when neither acceptance metric improves", async () => {
    await expect(runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100]), forceBalanceToleranceN: .01, signal: activeSignal(),
      solve: async (rhs) => rhs[0] === 100 ? gpuPass([0]) : gpuPass([.25]),
      evaluateMaster: async () => master([1]),
      evaluateCandidate: async () => candidate(.02, 2e-5, .1), postprocess,
    })).rejects.toThrow(/no improvement/i);
  });

  it("rejects a nonfinite master residual without dispatching a correction", async () => {
    let solves = 0;
    await expect(runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100]), forceBalanceToleranceN: .01, signal: activeSignal(),
      solve: async () => { solves += 1; return gpuPass([0]); },
      evaluateMaster: async () => master([Number.NaN]),
      evaluateCandidate: async () => candidate(.02, 2e-5, .1), postprocess,
    })).rejects.toMatchObject({ code: "diverged" });
    expect(solves).toBe(1);
  });

  it("propagates cancellation without a correction or final postprocess", async () => {
    const controller = new AbortController();
    let solves = 0;
    let postprocesses = 0;
    await expect(runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100]), forceBalanceToleranceN: .01, signal: controller.signal,
      solve: async () => { solves += 1; return gpuPass([0]); },
      evaluateMaster: async () => { controller.abort(); return master([1]); },
      evaluateCandidate: async () => candidate(.02, 2e-5, .1),
      postprocess: async () => { postprocesses += 1; return postprocess(); },
    })).rejects.toMatchObject({ name: "AbortError" });
    expect({ solves, postprocesses }).toEqual({ solves: 1, postprocesses: 0 });
  });

  it("propagates a GPU correction failure without fallback or candidate acceptance", async () => {
    const failure = new StructuralGpuError("device-lost", "lost during correction");
    let solves = 0;
    let candidateEvaluations = 0;
    await expect(runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100]), forceBalanceToleranceN: .01, signal: activeSignal(),
      solve: async () => { solves += 1; if (solves === 2) throw failure; return gpuPass([0]); },
      evaluateMaster: async () => master([1]),
      evaluateCandidate: async () => { candidateEvaluations += 1; return candidate(.02, 2e-5, .1); },
      postprocess,
    })).rejects.toBe(failure);
    expect(candidateEvaluations).toBe(1);
  });

  it("exhausts exactly three improving correction attempts", async () => {
    let solves = 0;
    let candidateIndex = 0;
    const balances = [.04, .03, .02, .015];
    await expect(runMixedPrecisionRefinement({
      initialRhsN: new Float32Array([100]), forceBalanceToleranceN: .01, signal: activeSignal(),
      solve: async () => { solves += 1; return gpuPass(solves === 1 ? [0] : [.25]); },
      evaluateMaster: async () => master([1]),
      evaluateCandidate: async () => {
        const balance = balances[candidateIndex++]!;
        return candidate(balance, balance * 1e-3, balance);
      },
      postprocess,
    })).rejects.toThrow(/three correction/i);
    expect(solves).toBe(4);
  });
});
