import { evaluateThermalField, solveThermalReference } from "../../reference";
import type { ThermalInput, ThermalResult } from "./thermal-contract";

export const THERMAL_TEMPERATURE_L2_LIMIT = 1e-3;
export const THERMAL_HEAT_RATE_ERROR_LIMIT = 2e-3;
export const THERMAL_ENERGY_IMBALANCE_LIMIT = 1e-3;

export interface ThermalVerification {
  readonly verified: true;
  readonly temperatureRelativeL2: number;
  readonly fieldRelativeL2: number;
  readonly heatRateRelativeError: number;
  readonly relativeEnergyImbalance: number;
  readonly independentlyEvaluatedHeatInputW: number;
  readonly independentlyEvaluatedHeatOutputW: number;
  readonly referenceIterations: number;
  readonly referenceRelativeResidual: number;
  readonly maximumTemperatureRelativeL2: typeof THERMAL_TEMPERATURE_L2_LIMIT;
  readonly maximumHeatRateRelativeError: typeof THERMAL_HEAT_RATE_ERROR_LIMIT;
  readonly maximumRelativeEnergyImbalance: typeof THERMAL_ENERGY_IMBALANCE_LIMIT;
}

function validateGrid(input: ThermalInput, result: ThermalResult): number {
  const expected = input.grid.cellDimensions, actual = result.grid?.cellDimensions;
  if (!Array.isArray(actual) || actual.length !== 3
    || actual.some((value, index) => value !== expected[index])) {
    throw new Error("Thermal verification grid dimensions do not match the canonical input");
  }
  if (result.grid.cellSizeM !== input.grid.cellSizeM
    || result.grid.originM.some((value, index) => value !== input.grid.originM[index])) {
    throw new Error("Thermal verification grid geometry does not match the canonical input");
  }
  return expected[0] * expected[1] * expected[2];
}

function validateField(value: unknown, length: number, label: string, nonnegative = false): void {
  if (!(value instanceof Float32Array) || value.length !== length
    || value.some((entry) => !Number.isFinite(entry) || nonnegative && entry < 0)) {
    throw new Error(`Thermal ${label} field must be dimensionally exact and finite`);
  }
}

function relativeL2(reference: Float64Array, candidate: Float32Array): number {
  let differenceSquared = 0, referenceSquared = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const difference = candidate[index]! - reference[index]!;
    differenceSquared += difference * difference;
    referenceSquared += reference[index]! * reference[index]!;
  }
  if (!Number.isFinite(differenceSquared) || !Number.isFinite(referenceSquared)) {
    throw new Error("Thermal temperature relative L2 evidence is undefined");
  }
  if (referenceSquared === 0) return differenceSquared === 0 ? 0 : Number.POSITIVE_INFINITY;
  return Math.sqrt(differenceSquared / referenceSquared);
}

export async function verifyThermalResult(
  input: ThermalInput, result: ThermalResult,
): Promise<ThermalVerification> {
  const cells = validateGrid(input, result);
  validateField(result.temperatureK, cells, "temperature");
  validateField(result.heatFluxWm2, cells * 3, "heat-flux");
  validateField(result.faceHeatFluxWm2, cells * 6, "face heat-flux");
  validateField(result.faceAreasM2, cells * 6, "face-area", true);

  const reference = await solveThermalReference(input);
  const evaluated = await evaluateThermalField(input, result.temperatureK);
  const temperatureRelativeL2 = relativeL2(reference.temperatureK, result.temperatureK);
  const fieldRelativeL2 = Math.max(
    relativeL2(evaluated.heatFluxWm2, result.heatFluxWm2),
    relativeL2(evaluated.faceHeatFluxWm2, result.faceHeatFluxWm2),
    relativeL2(evaluated.faceAreasM2, result.faceAreasM2),
  );
  const referenceRate = Math.max(reference.heatInputW, reference.heatOutputW);
  const rateDifference = Math.max(
    Math.abs(evaluated.heatInputW - reference.heatInputW),
    Math.abs(evaluated.heatOutputW - reference.heatOutputW),
  );
  const heatRateRelativeError = referenceRate === 0
    ? (rateDifference === 0 ? 0 : Number.POSITIVE_INFINITY) : rateDifference / referenceRate;
  if (!Number.isFinite(temperatureRelativeL2) || temperatureRelativeL2 > THERMAL_TEMPERATURE_L2_LIMIT) {
    throw new Error(`Thermal temperature relative L2 exceeds ${THERMAL_TEMPERATURE_L2_LIMIT}: ${temperatureRelativeL2}`);
  }
  if (!Number.isFinite(fieldRelativeL2) || fieldRelativeL2 > THERMAL_HEAT_RATE_ERROR_LIMIT) {
    throw new Error(`Thermal field disagreement exceeds ${THERMAL_HEAT_RATE_ERROR_LIMIT}: ${fieldRelativeL2}`);
  }
  if (!Number.isFinite(heatRateRelativeError) || heatRateRelativeError > THERMAL_HEAT_RATE_ERROR_LIMIT) {
    throw new Error(`Thermal heat-rate relative error exceeds ${THERMAL_HEAT_RATE_ERROR_LIMIT}: ${heatRateRelativeError}`);
  }
  if (!Number.isFinite(evaluated.relativeEnergyImbalance)
    || evaluated.relativeEnergyImbalance > THERMAL_ENERGY_IMBALANCE_LIMIT) {
    throw new Error(`Thermal relative energy imbalance exceeds ${THERMAL_ENERGY_IMBALANCE_LIMIT}: ${evaluated.relativeEnergyImbalance}`);
  }
  return {
    verified: true, temperatureRelativeL2, fieldRelativeL2, heatRateRelativeError,
    relativeEnergyImbalance: evaluated.relativeEnergyImbalance,
    independentlyEvaluatedHeatInputW: evaluated.heatInputW,
    independentlyEvaluatedHeatOutputW: evaluated.heatOutputW,
    referenceIterations: reference.iterations, referenceRelativeResidual: reference.relativeResidual,
    maximumTemperatureRelativeL2: THERMAL_TEMPERATURE_L2_LIMIT,
    maximumHeatRateRelativeError: THERMAL_HEAT_RATE_ERROR_LIMIT,
    maximumRelativeEnergyImbalance: THERMAL_ENERGY_IMBALANCE_LIMIT,
  };
}
