import { describe, expect, it } from "vitest";

import { DRONE_ARM_FOUNDATION_STUDY } from "./drone-arm-foundation";
import {
  referenceAssemblyWorldVolumes,
  referenceComponentForInstance,
  referenceDroneAssembly,
} from "./reference-drone-assembly";
import { REFERENCE_DRONE_CATALOG } from "./reference-drone-catalog";

describe("canonical reference drone assembly", () => {
  it("content-addresses every component and exact assembly instance", () => {
    expect(REFERENCE_DRONE_CATALOG.map(({ category }) => category).sort()).toEqual([
      "avionics", "avionics", "avionics", "battery", "body-interface", "fastener", "fastener", "motor", "propeller", "retention", "wiring", "wiring",
    ]);
    expect(referenceDroneAssembly.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(referenceDroneAssembly.components.every((instance) =>
      referenceComponentForInstance(instance).revision === instance.componentRevision)).toBe(true);
  });

  it("retains the battery with two physical straps and a mated XT60-to-ESC harness", () => {
    expect(referenceDroneAssembly.components.filter(({ instanceId }) => instanceId.startsWith("battery-strap-"))).toHaveLength(2);
    const battery = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "battery-6s-1550")!;
    const harness = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "battery-power-harness")!;
    const batteryInstance = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === "battery")!;
    const harnessInstance = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === "battery-power-harness")!;
    const endpoint = (instance: typeof batteryInstance, component: typeof battery, id: string) => {
      const connection = component.interfaces.find((item) => item.id === id)!;
      return ["x", "y", "z"].map((axis) =>
        instance.transform.position[axis as "x"].value + connection.position[axis as "x"].value,
      );
    };
    endpoint(batteryInstance, battery, "battery-power").forEach((value, axis) => {
      expect(value).toBeCloseTo(endpoint(harnessInstance, harness, "battery-side")[axis]!, 12);
    });
    const esc = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "esc-30x30")!;
    const escInstance = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === "esc")!;
    endpoint(escInstance, esc, "battery-power").forEach((value, axis) => {
      expect(value).toBeCloseTo(endpoint(harnessInstance, harness, "esc-side")[axis]!, 12);
    });
  });

  it("mounts the OpenESC and OpenFC stack on four physical 30.5 mm columns", () => {
    const mounts = referenceDroneAssembly.components.filter(({ instanceId }) =>
      instanceId.startsWith("board-stack-mount-"),
    );
    expect(mounts).toHaveLength(4);
    expect(mounts.map(({ transform }) => [
      transform.position.x.value,
      transform.position.y.value,
      transform.position.z.value,
    ])).toEqual([
      [0.01525, 0.01525, 0],
      [-0.01525, 0.01525, 0],
      [-0.01525, -0.01525, 0],
      [0.01525, -0.01525, 0],
    ]);
    const mount = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "board-stack-mount")!;
    expect(mount.interfaces.some(({ kind, id }) => kind === "mate" && id === "frame-through-hole")).toBe(true);
    expect(mount.interfaces.filter(({ kind }) => kind === "mate").map(({ id, position }) => [
      id,
      position.z.value,
    ])).toEqual([
      ["frame-through-hole", 0],
      ["openesc-bearing-plane", 0.006835],
      ["openfc-bearing-plane", 0.01731],
    ]);
    expect(mount.envelope.kind).toBe("cylinder");
    if (mount.envelope.kind === "cylinder") expect(mount.envelope.height.value).toBe(0.0281);
  });

  it("mates the trimmed motor pigtail to the routed harness without overlap or a loose end", () => {
    const motor = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "motor-2207")!;
    const harness = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "motor-wiring-corridor")!;
    const motorEnd = motor.interfaces.find(({ id }) => id === "motor-phase-leads")!;
    const harnessEnd = harness.interfaces.find(({ id }) => id === "motor-side")!;
    const harnessEscEnd = harness.interfaces.find(({ id }) => id === "esc-side")!;
    const esc = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "esc-30x30")!;
    const escEnd = esc.interfaces.find(({ id }) => id === "motor-east-phases")!;
    const motorInstance = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === "motor-east")!;
    const harnessInstance = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === "wiring-east")!;
    const escInstance = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === "esc")!;

    const world = (instance: typeof motorInstance, endpoint: typeof motorEnd) => [
      instance.transform.position.x.value + endpoint.position.x.value,
      instance.transform.position.y.value + endpoint.position.y.value,
      instance.transform.position.z.value + endpoint.position.z.value,
    ];
    expect(world(motorInstance, motorEnd)).toEqual(world(harnessInstance, harnessEnd));
    world(escInstance, escEnd).forEach((value, axis) => {
      expect(value).toBeCloseTo(world(harnessInstance, harnessEscEnd)[axis]!, 12);
    });
  });

  it("derives the exact solver protected volumes from component-local SI geometry", () => {
    const volumes = referenceAssemblyWorldVolumes("protectedVolumes");
    const eastRotor = volumes.find(({ id }) => id === "motor-east-propeller-swept-volume");

    expect(eastRotor).toMatchObject({
      kind: "cylinder",
      center: {
        x: { value: 0.105, unit: "m" },
        y: { value: 0, unit: "m" },
        z: { value: 0.02615, unit: "m" },
      },
      radius: { value: 0.066, unit: "m" },
      height: { value: 0.0085, unit: "m" },
    });
    expect(volumes.some((volume) =>
      volume.kind === "cylinder" && volume.radius.value === 0.06465)).toBe(false);
  });

  it("uses the same canonical revisions and world geometry for the arm solver fixture", () => {
    const foundation = DRONE_ARM_FOUNDATION_STUDY;
    const eastMotor = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === "motor-east")!;
    const foundationMotor = foundation.assembly.components.find(({ instanceId }) => instanceId === "motor-east")!;
    const eastRotor = referenceAssemblyWorldVolumes("protectedVolumes")
      .find(({ id }) => id === "motor-east-propeller-swept-volume");

    expect(foundationMotor).toEqual(eastMotor);
    expect(foundation.assembly.obstacleVolumes).toContainEqual(eastRotor);
    expect(foundation.assembly.preservedMounts.every((mount) => mount.position.z.value === 0.003)).toBe(true);
  });
});
