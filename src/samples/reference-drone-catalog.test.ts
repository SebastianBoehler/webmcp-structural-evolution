import { describe, expect, it } from "vitest";

import { compileParametricGeometry } from "../assembly/parametric-geometry";
import {
  REFERENCE_DRONE_CATALOG,
  referenceDroneAssembly,
} from "./reference-drone-catalog";

const EXPECTED_PROVENANCE = {
  "motor-2207": {
    exactPart: "Hobbywing XRotor-2207.5SL-1780KV",
    massKg: 0.038,
    massAccounting: "standalone",
    sources: [
      { kind: "manufacturer-datasheet", url: "https://www.hobbywing.com/en/uploads/file/20251117/feb50ba5342e53ce2431c20799f047d8.pdf" },
      { kind: "manufacturer-product-page", url: "https://www.hobbywing.com/en/products/xrotor-22075" },
    ],
  },
  "fc-esc-stack-30x30": {
    exactPart: "SpeedyBee F405 V4 + BLS 55A Stack, SB-F4V4-55-STACK",
    massKg: 0.034,
    massAccounting: "standalone",
    sources: [{ kind: "manufacturer-product-page", url: "https://www.speedybee.com/speedybee-f405-v4-bls-55a-30x30-fc-esc-stack/" }],
  },
  "battery-6s-1550": {
    exactPart: "Tattu TA-RL5-150C-1550-6S1P",
    massKg: 0.254,
    massAccounting: "standalone",
    sources: [{ kind: "manufacturer-product-page", url: "https://www.genstattu.com/tattu-r-line-version-5-0-1550mah-6s-150c-22-2v-lipo-battery-pack-with-xt60-plug/" }],
  },
  "fastener-m3x8": {
    exactPart: "Accu SSCF-M3-8-12.9-Z",
    massKg: 0.0008,
    massAccounting: "standalone",
    sources: [{ kind: "supplier-specification", url: "https://www.accu.co.uk/metric-cap-head-screws/386767-SSCF-M3-8-12-9-Z" }],
  },
  "motor-wiring-corridor": {
    exactPart: "Reference 3x20AWG motor-lead routing corridor rev 1",
    massKg: 0,
    massAccounting: "none",
    sources: [
      { kind: "derived-constraint-input", url: "https://www.hobbywing.com/en/uploads/file/20251117/feb50ba5342e53ce2431c20799f047d8.pdf" },
      { kind: "derived-constraint-input", url: "https://www.speedybee.com/speedybee-f405-v4-bls-55a-30x30-fc-esc-stack/" },
    ],
  },
  "propeller-5x4.3x3": {
    exactPart: "HQProp HQ5X4.3X3V2S-PC",
    massKg: 0.0038,
    massAccounting: "standalone",
    sources: [{ kind: "manufacturer-product-page", url: "https://www.hqprop.com/hq-freestyle-prop-5x43x3v2s-2cw2ccw-poly-carbonate-p0233.html" }],
  },
} as const;

describe("reference drone catalog", () => {
  it("uses the motor mount plane as one world-transform anchor", () => {
    const motor = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "motor-2207")!;
    const fastener = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "fastener-m3x8")!;
    const motorEast = referenceDroneAssembly.instances.find(({ id }) => id === "motor-east")!;
    const screw = referenceDroneAssembly.instances.find(({ id }) => id === "motor-east-fastener-1")!;
    const body = motor.collision[0]!;
    const shaft = motor.collision[1]!;
    const fastenerCollision = fastener.collision[0]!;

    expect(referenceDroneAssembly.anchorConvention).toBe("instance-position-is-component-local-anchor");
    expect(motor.anchor).toMatchObject({ id: "mount-plane", position: [0, 0, 0] });
    expect(fastener.anchor).toMatchObject({ id: "under-head-bearing-plane", position: [0, 0, 0] });
    expect(motorEast.position).toEqual([0.105, 0, 0.003]);
    expect(screw.position[0]).toBeCloseTo(0.110657);
    expect(screw.position.slice(1)).toEqual([0.005657, 0.003]);
    expect(motorEast.position[2] + body.center[2] - body.height! / 2).toBeCloseTo(0.003);
    expect(motorEast.position[2] + shaft.center[2] + shaft.height! / 2).toBeCloseTo(0.0349);
    expect(motor.interfaces.filter(({ kind }) => kind === "mount").every(({ position }) =>
      motorEast.position[2] + position[2] === 0.003)).toBe(true);
    expect(screw.position[2] + fastenerCollision.center[2] - fastenerCollision.height! / 2)
      .toBeCloseTo(0);
    expect(screw.position[2] + fastenerCollision.center[2] + fastenerCollision.height! / 2)
      .toBeCloseTo(0.011);
  });

  it("keeps every modeled component traceable to an accessed source", () => {
    const actualProvenance = Object.fromEntries(REFERENCE_DRONE_CATALOG.map((component) => [
      component.id,
      {
        exactPart: component.exactPart,
        massKg: component.massKg,
        massAccounting: component.massAccounting,
        sources: component.provenance.sources.map(({ kind, url }) => ({ kind, url })),
      },
    ]));

    expect(actualProvenance).toEqual(EXPECTED_PROVENANCE);
    expect(REFERENCE_DRONE_CATALOG.filter(({ massAccounting }) => massAccounting === "standalone")
      .every(({ massKg }) => massKg > 0)).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.filter(({ massAccounting }) => massAccounting === "none")
      .every(({ massKg }) => massKg === 0)).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.every((component) =>
      component.provenance.dimensionalUncertainty.trim().length > 0)).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.every((component) =>
      component.provenance.dimensionsUsed.length > 0)).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.every((component) =>
      component.provenance.sources.length > 0)).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.flatMap((component) =>
      component.provenance.sources).every((source) =>
      source.accessedOn === "2026-08-26")).toBe(true);
    expect(REFERENCE_DRONE_CATALOG.flatMap((component) =>
      component.provenance.sources).every((source) =>
      source.redistribution.trim().length > 0)).toBe(true);
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
