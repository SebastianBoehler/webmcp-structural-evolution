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
      "avionics", "avionics", "battery", "body-interface", "fastener", "motor", "propeller", "wiring",
    ]);
    expect(referenceDroneAssembly.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(referenceDroneAssembly.components.every((instance) =>
      referenceComponentForInstance(instance).revision === instance.componentRevision)).toBe(true);
  });

  it("mates the trimmed motor pigtail to the routed harness without overlap or a loose end", () => {
    const motor = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "motor-2207")!;
    const harness = REFERENCE_DRONE_CATALOG.find(({ id }) => id === "motor-wiring-corridor")!;
    const motorEnd = motor.interfaces.find(({ id }) => id === "motor-phase-leads")!;
    const harnessEnd = harness.interfaces.find(({ id }) => id === "motor-side")!;
    const motorInstance = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === "motor-east")!;
    const harnessInstance = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === "wiring-east")!;

    const world = (instance: typeof motorInstance, endpoint: typeof motorEnd) => [
      instance.transform.position.x.value + endpoint.position.x.value,
      instance.transform.position.y.value + endpoint.position.y.value,
      instance.transform.position.z.value + endpoint.position.z.value,
    ];
    expect(world(motorInstance, motorEnd)).toEqual(world(harnessInstance, harnessEnd));
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
