import { describe, expect, it } from "vitest";

import { DRONE_ARM_FOUNDATION_STUDY } from "./drone-arm-foundation";
import {
  referenceAssemblyWorldVolumes,
  referenceComponentForInstance,
  referenceDroneAssembly,
} from "./reference-drone-assembly";
import { REFERENCE_DRONE_CATALOG } from "./reference-drone-catalog";

describe("canonical reference drone assembly", () => {
  it("is a sourced ready-to-fly analog assembly rather than a decorative airframe", () => {
    const required = [
      "motor-2207", "propeller-5x4.3x3", "flight-controller-30x30", "esc-30x30",
      "battery-6s-1550", "fpv-camera", "video-transmitter", "video-antenna", "radio-receiver",
    ];
    expect(required.every((id) => referenceDroneAssembly.components.some(
      (instance) => referenceComponentForInstance(instance).id === id,
    ))).toBe(true);
    expect(referenceDroneAssembly.missingComponents).toEqual([]);
    expect(referenceDroneAssembly.incompatibleComponents).toEqual([]);
    expect(referenceDroneAssembly.ambiguousComponents).toEqual([]);
  });

  it("content-addresses every component and exact assembly instance", () => {
    expect(REFERENCE_DRONE_CATALOG.map(({ id }) => id).sort()).toEqual([
      "battery-6s-1550", "battery-power-harness", "battery-retention-strap", "body-interface",
      "camera-fastener-m2x4", "esc-30x30", "fastener-m3x8", "flight-controller-30x30",
      "fpv-camera", "motor-2207", "motor-wiring-corridor", "propeller-5x4.3x3", "radio-receiver",
      "stack-bolt-m3x25", "stack-locknut-m3", "stack-spacer-m3x5", "stack-spacer-m3x6",
      "video-antenna", "video-transmitter",
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

  it("mounts the OpenESC and OpenFC stack with catalog bolts, spacers, and locknuts", () => {
    const bolts = referenceDroneAssembly.components.filter(({ instanceId }) =>
      instanceId.startsWith("stack-bolt-"),
    );
    expect(bolts).toHaveLength(4);
    expect(bolts.map(({ transform }) => [
      transform.position.x.value,
      transform.position.y.value,
      transform.position.z.value,
    ])).toEqual([
      [0.01525, 0.01525, 0],
      [-0.01525, 0.01525, 0],
      [-0.01525, -0.01525, 0],
      [0.01525, -0.01525, 0],
    ]);
    expect(referenceDroneAssembly.components.filter(({ instanceId }) => instanceId.startsWith("stack-lower-spacer-"))).toHaveLength(4);
    expect(referenceDroneAssembly.components.filter(({ instanceId }) => instanceId.startsWith("stack-inter-spacer-"))).toHaveLength(4);
    expect(referenceDroneAssembly.components.filter(({ instanceId }) => instanceId.startsWith("stack-locknut-"))).toHaveLength(4);
    expect(REFERENCE_DRONE_CATALOG.filter(({ id }) => id.startsWith("stack-")).every(
      ({ manufacturer }) => manufacturer !== "Sunderlabs",
    )).toBe(true);
  });

  it("mates the camera, TX800, antennas, and receiver with their real interfaces", () => {
    const instance = (id: string) => referenceDroneAssembly.components.find(({ instanceId }) => instanceId === id)!;
    const component = (id: string) => REFERENCE_DRONE_CATALOG.find((candidate) => candidate.id === id)!;
    const world = (instanceId: string, componentId: string, interfaceId: string) => {
      const placed = instance(instanceId);
      const local = component(componentId).interfaces.find(({ id }) => id === interfaceId)!.position;
      const yaw = placed.transform.orientation.yaw.value;
      return [
        placed.transform.position.x.value + Math.cos(yaw) * local.x.value - Math.sin(yaw) * local.y.value,
        placed.transform.position.y.value + Math.sin(yaw) * local.x.value + Math.cos(yaw) * local.y.value,
        placed.transform.position.z.value + local.z.value,
      ].map((value) => Math.round(value * 1e12) / 1e12);
    };

    expect(world("fpv-camera", "fpv-camera", "camera-mount-left")).toEqual([
      instance("camera-fastener-left").transform.position.x.value,
      instance("camera-fastener-left").transform.position.y.value,
      instance("camera-fastener-left").transform.position.z.value,
    ]);
    expect(world("fpv-camera", "fpv-camera", "camera-mount-right")).toEqual([
      instance("camera-fastener-right").transform.position.x.value,
      instance("camera-fastener-right").transform.position.y.value,
      instance("camera-fastener-right").transform.position.z.value,
    ]);
    expect(component("camera-fastener-m2x4").envelope.orientation.roll.value).toBe(-Math.PI / 2);

    const vtxMounts = component("video-transmitter").mountInterfaces.map((mount) => world(
      "video-transmitter", "video-transmitter", mount.id,
    ).slice(0, 2).join(":"));
    const vtxFasteners = referenceDroneAssembly.components.filter(({ instanceId }) =>
      instanceId.startsWith("vtx-fastener-"),
    ).map(({ transform }) => [transform.position.x.value, transform.position.y.value].map(
      (value) => Math.round(value * 1e12) / 1e12,
    ).join(":"));
    expect(vtxFasteners.sort()).toEqual(vtxMounts.sort());
    expect(world("video-transmitter", "video-transmitter", "antenna-mmcx")).toEqual(
      world("video-antenna", "video-antenna", "antenna-mmcx"),
    );
    expect(component("radio-receiver").interfaces.some(({ id }) => id === "fc-crsf")).toBe(true);
    expect(component("radio-receiver").protectedVolumes.map(({ id }) => id)).toEqual([
      "rp1-board-keepout", "rp1-coax-keepout", "rp1-t-element-keepout",
    ]);
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
