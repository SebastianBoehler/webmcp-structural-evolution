import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
  pcg: vi.fn(), postprocess: vi.fn(), field: vi.fn(), master: vi.fn(),
  reference: vi.fn(), relativeL2: vi.fn(), pack: vi.fn(), devices: [] as unknown[],
}));

vi.mock("../../reference", () => ({
  evaluateStructuralField: seam.field,
  evaluateStructuralIterateF64: seam.master,
  solveStructuralReference: seam.reference,
  relativeL2: seam.relativeL2,
}));
vi.mock("./pcg", () => ({ runStructuralPcg: seam.pcg }));
vi.mock("./structural-gpu-postprocess", () => ({ postprocessStructuralField: seam.postprocess }));
vi.mock("./structural-result-artifacts", () => ({ packInteractiveStructuralRunResult: seam.pack }));

import { createWebGpuStructuralAdapter } from "./webgpu-structural-adapter";
import { RECORDING_GPU_GLOBALS, recordingGpu } from "./recording-gpu-device";
import { structuralRequest } from "./structural-test-fixtures";

describe("WebGPU structural refinement integration", () => {
  beforeEach(() => {
    vi.stubGlobal("GPUBufferUsage", RECORDING_GPU_GLOBALS.GPUBufferUsage);
    vi.stubGlobal("GPUShaderStage", RECORDING_GPU_GLOBALS.GPUShaderStage);
    vi.stubGlobal("GPUMapMode", RECORDING_GPU_GLOBALS.GPUMapMode);
    seam.devices.length = 0;
    seam.relativeL2.mockReset().mockResolvedValue(0);
    seam.pack.mockReset().mockImplementation(async (_request, output) => ({
      output, truthLevel: output.truthLevel, artifacts: [],
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("runs a correction and final postprocess on the one acquired device", async () => {
    const recorded = recordingGpu();
    vi.stubGlobal("navigator", { gpu: recorded.gpu });
    let solveCount = 0;
    seam.pcg.mockReset().mockImplementation(async (device, system) => {
      seam.devices.push(device);
      solveCount += 1;
      const displacementM = new Float32Array(system.fixedDofs.length);
      if (solveCount === 2) displacementM[displacementM.length - 1] = .25;
      return {
        displacementM, vonMisesStressPa: new Float32Array(system.activeCells.length),
        iterations: 4, relativeResidual: 1e-6, recomputedF32RelativeResidual: .02,
        forceBalanceErrorN: .02, complianceJ: 1,
      };
    });
    let candidateCount = 0;
    seam.field.mockReset().mockImplementation(async (input) => ({
      reactionN: [-1_000, 0, 0], vonMisesStressPa: new Float32Array(input.activeCells.length),
      forceBalanceErrorN: candidateCount++ === 0 ? .2 : .005,
      complianceJ: 1, strainEnergyJ: .5,
      energyRelativeMismatch: candidateCount === 1 ? 2e-5 : 5e-6,
      directRelativeResidual: .01,
    }));
    seam.master.mockReset().mockImplementation(async (_input, field) => {
      const freeResidualN = new Float64Array(field.length);
      freeResidualN[freeResidualN.length - 1] = 2;
      return { freeResidualN };
    });
    seam.postprocess.mockReset().mockImplementation(async (device, system) => {
      seam.devices.push(device);
      return {
        vonMisesStressPa: new Float32Array(system.activeCells.length),
        recomputedF32RelativeResidual: .001, forceBalanceErrorN: .005, complianceJ: 1,
      };
    });
    seam.reference.mockReset().mockImplementation(async (input) => ({
      displacementM: new Float32Array(input.fixedDofs.length),
      vonMisesStressPa: new Float32Array(input.activeCells.length),
      iterations: 3, relativeResidual: 1e-7, forceBalanceErrorN: .001, complianceJ: 1,
    }));

    const run = await createWebGpuStructuralAdapter().run(
      await structuralRequest(), new AbortController().signal, () => undefined,
    );

    expect(run.output.verification).toMatchObject({ refinementCount: 1 });
    expect(run.output.verification.refinementPasses).toHaveLength(2);
    expect(seam.pcg).toHaveBeenCalledTimes(2);
    expect(new Set(seam.devices).size).toBe(1);
    expect(recorded.device.destroy).toHaveBeenCalledOnce();
  });
});
