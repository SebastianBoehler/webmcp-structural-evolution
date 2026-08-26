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

const validComponent = {
  id: "motor-2207",
  category: "motor",
  geometryCoordinates: "component-local",
  manufacturer: "Sunderlabs",
  partNumber: "MOTOR-2207",
  provenance: { kind: "manufacturer-datasheet", reference: "datasheet" },
  mass: { value: 0.038, unit: "kg" },
  centerOfMass: origin,
  envelope: { kind: "box", id: "envelope", center: origin, size: { x: metre(0.03), y: metre(0.03), z: metre(0.02) } },
  mountInterfaces: [],
  keepOutVolumes: [],
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
  });
});
