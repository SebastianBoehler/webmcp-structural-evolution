import { describe, expect, it } from "vitest";

import { defineComponent } from "./component-model";

const metre = (value: number) => ({ value, unit: "m" as const });
const millimetre = (value: number) => ({ value, unit: "mm" as const });
const degrees = (value: number) => ({ value, unit: "deg" as const });
const origin = { x: metre(0), y: metre(0), z: metre(0) };
const orientation = {
  roll: degrees(0),
  pitch: degrees(0),
  yaw: degrees(0),
};

const provenance = {
  mode: "modeled-from-specification",
  licence: {
    status: "facts-only",
    reference: "https://example.com/terms",
  },
  uncertainty: [{ property: "body envelope", statement: "Published dimensions, tolerance not stated." }],
  sources: [{
    id: "manufacturer-sheet",
    classification: "manufacturer-datasheet",
    title: "Motor dimensional sheet",
    reference: "https://example.com/motor.pdf",
    sourceTimestamp: "2026-07-01",
    accessedOn: "2026-08-26",
    redistribution: "facts-only",
  }],
  sourceObservations: [{
    property: "body diameter",
    value: 30,
    unit: "mm",
    sourceId: "manufacturer-sheet",
  }],
};

const validComponent = {
  id: "motor-2207",
  category: "motor",
  geometryCoordinates: "component-local",
  manufacturer: "Sunderlabs",
  partNumber: "MOTOR-2207",
  provenance,
  mass: { value: 0.038, unit: "kg" },
  centerOfMass: origin,
  envelope: { kind: "box", id: "envelope", center: origin, size: { x: metre(0.03), y: metre(0.03), z: metre(0.02) } },
  anchor: { id: "mount-plane", coordinates: "component-local", position: origin },
  massAccounting: "standalone",
  optimizationRole: "fixed-component",
  collisionVolumes: [{ kind: "box", id: "collision", center: origin, size: { x: metre(0.03), y: metre(0.03), z: metre(0.02) } }],
  protectedVolumes: [],
  mountInterfaces: [],
  loadContributions: [],
  allowedOrientations: [orientation],
  geometry: {
    kind: "parametric",
    graph: {
      nodes: [{ kind: "box", id: "motor-body", center: origin, size: { x: metre(0.03), y: metre(0.03), z: metre(0.02) } }],
    },
  },
  interfaces: [{
    kind: "mount",
    id: "mount-north",
    coordinates: "component-local",
    position: origin,
    orientation,
    diameter: metre(0.003),
    fastenerType: "M3",
  }],
};

describe("component definitions", () => {
  it("rejects executable component geometry", async () => {
    await expect(defineComponent({
      ...validComponent,
      geometry: { kind: "script", code: "fetch('/')" },
    })).rejects.toThrow();
  });

  it("keeps component interfaces in component-local SI coordinates", async () => {
    const component = await defineComponent(validComponent);

    expect(component.interfaces?.[0]).toMatchObject({
      kind: "mount",
      coordinates: "component-local",
    });
    expect(component.mass.unit).toBe("kg");
  });

  it("normalizes accepted source engineering values to SI", async () => {
    const component = await defineComponent({
      ...validComponent,
      mass: { value: 38, unit: "g" },
      centerOfMass: { x: millimetre(10), y: millimetre(0), z: millimetre(0) },
      allowedOrientations: [{
        roll: degrees(180),
        pitch: degrees(0),
        yaw: degrees(0),
      }],
    });

    expect(component.mass).toEqual({ value: 0.038, unit: "kg" });
    expect(component.centerOfMass.x).toEqual({ value: 0.01, unit: "m" });
    expect(component.allowedOrientations[0]?.roll).toEqual({ value: Math.PI, unit: "rad" });
    expect(component.provenance.sourceObservations[0]).toEqual({
      property: "body diameter",
      value: 30,
      unit: "mm",
      sourceId: "manufacturer-sheet",
    });
  });

  it.each(["motor", "fastener", "avionics", "battery", "wiring", "propeller", "body-interface"] as const)(
    "accepts the required reference category: %s",
    async (category) => {
      await expect(defineComponent({ ...validComponent, id: category, category })).resolves.toMatchObject({ category });
    },
  );

  it("rejects a component without a usable display representation", async () => {
    const { geometry: _geometry, ...withoutGeometry } = validComponent;

    await expect(defineComponent(withoutGeometry)).rejects.toThrow(/geometry/i);
  });
});
