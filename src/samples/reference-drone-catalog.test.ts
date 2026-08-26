import { describe, expect, it } from "vitest";

import { compileParametricGeometry } from "../assembly/parametric-geometry";
import {
  REFERENCE_DRONE_CATALOG,
  referenceDroneAssembly,
} from "./reference-drone-catalog";

describe("reference drone catalog", () => {
  it("keeps every modeled component traceable to an accessed source", () => {
    expect(REFERENCE_DRONE_CATALOG.every((component) =>
      component.provenance.sources.length > 0)).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.flatMap((component) =>
      component.provenance.sources).every((source) =>
      source.accessedOn === "2026-08-26")).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.every((component) =>
      component.provenance.mode === "modeled-from-specification")).toBe(true);
  });

  it("models the motor as a bounded multi-feature graph with mount semantics", async () => {
    const motor = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "motor-2207");

    expect(motor?.geometry.kind).toBe("parametric");
    if (motor?.geometry.kind !== "parametric") throw new Error("motor graph missing");
    expect(motor.geometry.graph.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "motor-base",
      "motor-stator",
      "motor-bell",
      "motor-shaft",
      "motor-mount-interface",
      "motor-with-four-mount-holes",
    ]));
    await expect(compileParametricGeometry(motor.geometry.graph)).resolves.toMatchObject({
      sizeMm: [28, 28, 31.9],
    });
  });

  it("assembles four motors and protects every rotor envelope from optimization", () => {
    expect(referenceDroneAssembly.instances.filter(({ componentId }) =>
      componentId === "motor-2207")).toHaveLength(4);
    const rotors = referenceDroneAssembly.instances.filter(({ componentId }) =>
      componentId === "propeller-5x4.3x3");
    expect(rotors).toHaveLength(4);
    expect(rotors.every(({ optimizationRole }) => optimizationRole === "protected")).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.find(({ id }) => id === "propeller-5x4.3x3"))
      .toMatchObject({ optimizationRole: "protected" });
  });

  it("represents the physical stack, battery, fasteners, and wiring corridors", () => {
    expect(referenceDroneAssembly.instances.some(({ componentId }) =>
      componentId === "fc-esc-stack-30x30")).toBe(true);
    expect(referenceDroneAssembly.instances.some(({ componentId }) =>
      componentId === "battery-6s-1550")).toBe(true);
    expect(referenceDroneAssembly.instances.filter(({ componentId }) =>
      componentId === "fastener-m3x8")).toHaveLength(16);
    expect(referenceDroneAssembly.instances.filter(({ componentId }) =>
      componentId === "motor-wiring-corridor")).toHaveLength(2);
  });
});
