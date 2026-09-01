import { runBufferPcg } from "../structural/pcg";
import {
  createDeviceGuard, withStructuralGpuErrorScopes,
  StructuralGpuError,
} from "../structural/structural-gpu-runtime";
import type { ThermalInput } from "./thermal-contract";
import {
  addThermalReferenceTemperature, buildThermalSystem,
  createThermalPcgCallbacks, deriveThermalFields,
} from "./thermal-gpu-commands";
import { createThermalGpuPipelines } from "./thermal-gpu-pipelines";
import { createThermalGpuResources } from "./thermal-gpu-resources";

export const THERMAL_RESIDUAL_TOLERANCE = 1e-8;
export const THERMAL_MAX_ITERATIONS = 4_096;

export interface ThermalGpuSolve {
  readonly iterations: number;
  readonly relativeResidual: number;
  readonly temperatureK: Float32Array;
  readonly heatFluxWm2: Float32Array;
  readonly faceHeatFluxWm2: Float32Array;
  readonly faceAreasM2: Float32Array;
  readonly heatInputW: number;
  readonly heatOutputW: number;
  readonly energyImbalanceW: number;
  readonly relativeEnergyImbalance: number;
}

function thermalBalance(sourcePower: Float32Array, thermostatPower: Float32Array) {
  let heatInputW = 0, heatOutputW = 0;
  for (const field of [sourcePower, thermostatPower]) for (const power of field) {
    if (power >= 0) heatInputW += power;
    else heatOutputW -= power;
  }
  const energyImbalanceW = heatInputW - heatOutputW;
  const imposed = Math.max(heatInputW, heatOutputW);
  return {
    heatInputW, heatOutputW, energyImbalanceW,
    relativeEnergyImbalance: imposed === 0 ? 0 : Math.abs(energyImbalanceW) / imposed,
  };
}

export async function solveThermalGpu(
  device: GPUDevice, input: ThermalInput, signal: AbortSignal,
  emit: (progress: number) => void,
): Promise<ThermalGpuSolve> {
  const guard = createDeviceGuard(device, signal);
  return withStructuralGpuErrorScopes(device, guard, async () => {
    const resources = createThermalGpuResources(device, input);
    try {
      const count = input.activeCells.length;
      const pipelines = await createThermalGpuPipelines(device, guard);
      await buildThermalSystem(device, guard, pipelines, resources, count);
      const { vectors, callbacks } = createThermalPcgCallbacks(
        device, guard, pipelines, resources, count,
        (iteration) => emit(Math.min(0.85, 0.1 + 0.75 * iteration / THERMAL_MAX_ITERATIONS)),
      );
      const convergence = await runBufferPcg(vectors, callbacks, {
        maxIterations: THERMAL_MAX_ITERATIONS, tolerance: THERMAL_RESIDUAL_TOLERANCE,
      });
      await addThermalReferenceTemperature(device, guard, pipelines, resources, count);
      const fields = await deriveThermalFields(device, guard, pipelines, resources, count);
      if (fields.temperatureK.length !== count || fields.heatFluxWm2.length !== count * 3
        || fields.faceHeatFluxWm2.length !== count * 6 || fields.faceAreasM2.length !== count * 6
        || fields.thermostatPowerW.length !== count
        || !fields.temperatureK.every(Number.isFinite) || !fields.heatFluxWm2.every(Number.isFinite)
        || !fields.faceHeatFluxWm2.every(Number.isFinite) || !fields.faceAreasM2.every(Number.isFinite)
        || !fields.thermostatPowerW.every(Number.isFinite)) {
        throw new StructuralGpuError("diverged", "Thermal WebGPU fields are invalid or non-finite");
      }
      return {
        ...convergence, temperatureK: fields.temperatureK, heatFluxWm2: fields.heatFluxWm2,
        faceHeatFluxWm2: fields.faceHeatFluxWm2, faceAreasM2: fields.faceAreasM2,
        ...thermalBalance(resources.sourcePowerValues, fields.thermostatPowerW),
      };
    } finally {
      resources.destroy();
    }
  });
}
