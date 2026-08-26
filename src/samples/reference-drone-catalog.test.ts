import { describe, expect, it } from "vitest";

import { compileParametricGeometry } from "../assembly/parametric-geometry";
import { referenceAssemblyInstancesFor } from "./reference-drone-assembly";
import { REFERENCE_DRONE_CATALOG, referenceComponent } from "./reference-drone-catalog";

const EXPECTED_SOURCES = {
  "motor-2207": ["manufacturer-datasheet", "manufacturer-product-page", "engineering-drawing"],
  "flight-controller-30x30": ["engineering-drawing", "manufacturer-product-page"],
  "esc-30x30": ["engineering-drawing", "manufacturer-product-page"],
  "battery-6s-1550": ["manufacturer-product-page"],
  "battery-retention-strap": ["engineering-drawing"],
  "battery-power-harness": ["manufacturer-product-page", "engineering-drawing"],
  "fastener-m3x8": ["supplier-specification"],
  "motor-wiring-corridor": ["manufacturer-datasheet", "manufacturer-product-page", "engineering-drawing"],
  "propeller-5x4.3x3": ["manufacturer-product-page"],
  "fpv-camera": ["manufacturer-datasheet"],
  "body-interface": ["engineering-drawing"],
} as const;

describe("reference drone catalog", () => {
  it("retains original observations beside canonical SI engineering values", () => {
    const motor = referenceComponent("motor-2207");
    const diameter = motor.provenance.sourceObservations.find(({ property }) => property === "motor diameter");

    expect(motor.mass).toEqual({ value: 0.038, unit: "kg" });
    expect(motor.collisionVolumes[0]).toMatchObject({
      kind: "cylinder", radius: { value: 0.014, unit: "m" }, height: { value: 0.0199, unit: "m" },
    });
    expect(diameter).toMatchObject({ value: 28, unit: "mm", sourceId: "hobbywing-datasheet" });
  });

  it("keeps every component traceable with classification, access time, licence, and uncertainty", () => {
    expect(Object.fromEntries(REFERENCE_DRONE_CATALOG.map((component) => [
      component.id,
      component.provenance.sources.map(({ classification }) => classification),
    ]))).toEqual(EXPECTED_SOURCES);
    expect(REFERENCE_DRONE_CATALOG.every(({ provenance }) => provenance.sources.every(
      ({ accessedOn, sourceTimestamp }) => accessedOn === "2026-08-26" && sourceTimestamp.length > 0,
    ))).toBe(true);
    const openHardware = REFERENCE_DRONE_CATALOG.filter(({ id }) =>
      id === "flight-controller-30x30" || id === "esc-30x30");
    expect(openHardware.every(({ provenance }) =>
      provenance.mode === "sourced-asset"
      && provenance.licence.status === "redistributable"
      && provenance.sources.every(({ redistribution }) => redistribution === "redistributable"))).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.filter((component) => !openHardware.includes(component)).every(({ provenance }) =>
      provenance.licence.status === "facts-only")).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.every(({ provenance }) =>
      provenance.uncertainty.length > 0 && provenance.sourceObservations.length > 0)).toBe(true);
  });

  it("requires one bounded parametric display graph for every reference component", () => {
    expect(REFERENCE_DRONE_CATALOG.every(({ geometry }) =>
      geometry.kind === "parametric" && geometry.graph.nodes.length > 0)).toBe(true);
  });

  it("compiles every declared reference display representation", async () => {
    const compiled = await Promise.all(REFERENCE_DRONE_CATALOG.map((component) => {
      if (component.geometry.kind !== "parametric") throw new Error(`missing graph: ${component.id}`);
      return compileParametricGeometry(component.geometry.graph);
    }));

    expect(compiled.every(({ triangleCount, sizeMm }) =>
      triangleCount > 0 && sizeMm.every((size) => size > 0))).toBe(true);
  });

  it("compiles the motor graph with exact local bounds and mount semantics", async () => {
    const motor = referenceComponent("motor-2207");
    if (motor.geometry.kind !== "parametric") throw new Error("motor graph missing");

    expect(motor.geometry.graph.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "motor-base", "motor-stator", "motor-bell", "motor-shaft",
      "motor-mount-interface", "motor-with-four-mount-holes",
    ]));
    await expect(compileParametricGeometry(motor.geometry.graph)).resolves.toMatchObject({ sizeMm: [28, 28, 31.9] });
  });

  it("assembles every physical category by exact component revision", () => {
    expect(referenceAssemblyInstancesFor("motor-2207")).toHaveLength(4);
    expect(referenceAssemblyInstancesFor("propeller-5x4.3x3")).toHaveLength(4);
    expect(referenceAssemblyInstancesFor("fastener-m3x8")).toHaveLength(16);
    expect(referenceAssemblyInstancesFor("motor-wiring-corridor")).toHaveLength(4);
    expect(referenceAssemblyInstancesFor("flight-controller-30x30")).toHaveLength(1);
    expect(referenceAssemblyInstancesFor("esc-30x30")).toHaveLength(1);
    expect(referenceAssemblyInstancesFor("battery-6s-1550")).toHaveLength(1);
    expect(referenceAssemblyInstancesFor("battery-retention-strap")).toHaveLength(2);
    expect(referenceAssemblyInstancesFor("battery-power-harness")).toHaveLength(1);
    expect(referenceAssemblyInstancesFor("fpv-camera")).toHaveLength(1);
    expect(referenceAssemblyInstancesFor("body-interface")).toHaveLength(1);
  });
});
