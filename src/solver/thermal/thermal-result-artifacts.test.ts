import { describe, expect, it } from "vitest";

import { validateThermalArtifactQuantityMetadata } from "./thermal-result-artifacts";

const utf8 = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("thermal result artifact units", () => {
  it("requires exact temperature, face-flux, area, heat-rate, and mixed-summary units", () => {
    const temperature = { temperatureK: new Float32Array([300]), quantityMetadataUtf8: utf8({
      coordinateLengthUnit: "m", quantity: "temperature", quantityUnit: "K",
    }) };
    expect(() => validateThermalArtifactQuantityMetadata(
      "application/vnd.structural-evolution.thermal-field; quantity=temperature", temperature,
    )).not.toThrow();
    expect(() => validateThermalArtifactQuantityMetadata(
      "application/vnd.structural-evolution.thermal-field; quantity=temperature",
      { temperatureK: temperature.temperatureK },
    )).toThrow(/quantity metadata/);
    expect(() => validateThermalArtifactQuantityMetadata(
      "application/vnd.structural-evolution.thermal-field; quantity=temperature",
      { ...temperature, quantityMetadataUtf8: utf8({ coordinateLengthUnit: "m", quantity: "temperature", quantityUnit: "C" }) },
    )).toThrow(/quantity metadata/);

    const flux = { heatFluxWm2: new Float32Array(3), faceHeatFluxWm2: new Float32Array(6),
      faceAreasM2: new Float32Array(6), quantityMetadataUtf8: utf8({
        coordinateLengthUnit: "m", quantity: "heat-flux", quantityUnit: "W/m^2",
        faceAreaUnit: "m^2", heatRateUnit: "W", faceSignConvention: "positive-outward-normal",
      }) };
    expect(() => validateThermalArtifactQuantityMetadata(
      "application/vnd.structural-evolution.thermal-field; quantity=heat-flux", flux,
    )).not.toThrow();

    const summary = { metrics: new Float64Array(6), metricsSchemaUtf8: utf8({
      coordinateLengthUnit: "m", scalars: [
        ["iterations", "1"], ["relativeResidual", "1"], ["heatInputW", "W"],
        ["heatOutputW", "W"], ["energyImbalanceW", "W"], ["relativeEnergyImbalance", "1"],
      ],
    }) };
    expect(() => validateThermalArtifactQuantityMetadata(
      "application/vnd.structural-evolution.thermal-result", summary,
    )).not.toThrow();
    expect(() => validateThermalArtifactQuantityMetadata(
      "application/vnd.structural-evolution.thermal-result",
      { ...summary, metricsSchemaUtf8: utf8({ coordinateLengthUnit: "m", scalars: [["iterations", "1"]] }) },
    )).toThrow(/mixed-summary/);
  });
});
