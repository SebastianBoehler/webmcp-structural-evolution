import { describe, expect, it } from "vitest";

import { defineInventory, evaluateInventory } from "../domain/design";
import { DRONE_ARM_FOUNDATION_STUDY } from "./drone-arm-foundation";

describe("DRONE_ARM_FOUNDATION_STUDY", () => {
  it("strictly validates inventory before freezing it", () => {
    expect(() =>
      defineInventory([
        { ...DRONE_ARM_FOUNDATION_STUDY.inventory[0], unexpected: true },
      ]),
    ).toThrow(/unrecognized key/i);
    expect(Object.isFrozen(DRONE_ARM_FOUNDATION_STUDY.inventory)).toBe(true);
    expect(Object.isFrozen(DRONE_ARM_FOUNDATION_STUDY.inventory[0])).toBe(true);
  });

  it("reports the exact M3 fastener stock shortfall", () => {
    const fastenerRevision = DRONE_ARM_FOUNDATION_STUDY.components.find(
      (component) => component.id === "fastener-m3x8",
    )?.revision;

    expect(
      evaluateInventory(
        DRONE_ARM_FOUNDATION_STUDY.inventory,
        DRONE_ARM_FOUNDATION_STUDY.assembly,
      ),
    ).toEqual({
      status: "insufficient-stock",
      shortages: [
        {
          componentRevision: fastenerRevision,
          requiredQuantity: 4,
          ownedQuantity: 3,
          shortfall: 1,
        },
      ],
    });
  });

  it("does not label an unresolved assembly buildable", () => {
    const fastenerRevision = DRONE_ARM_FOUNDATION_STUDY.components.find(
      (component) => component.id === "fastener-m3x8",
    )?.revision;
    const motorRevision = DRONE_ARM_FOUNDATION_STUDY.components.find(
      (component) => component.id === "motor-2207",
    )?.revision;
    const completeInventory = DRONE_ARM_FOUNDATION_STUDY.inventory.map((item) =>
      item.componentRevision === fastenerRevision
        ? { ...item, ownedQuantity: 4 }
        : item,
    );
    const unresolvedAssembly = {
      ...DRONE_ARM_FOUNDATION_STUDY.assembly,
      ambiguousComponents: [motorRevision!],
    };

    expect(evaluateInventory(completeInventory, unresolvedAssembly).status).toBe(
      "unresolved-assembly",
    );
  });

  it("keeps the intended motor and body interfaces exact", () => {
    const motor = DRONE_ARM_FOUNDATION_STUDY.components.find(
      (component) => component.id === "motor-2207",
    );
    const bodyInterface = DRONE_ARM_FOUNDATION_STUDY.components.find(
      (component) => component.id === "body-interface",
    );
    const propeller = DRONE_ARM_FOUNDATION_STUDY.components.find(
      (component) => component.id === "propeller-5x4.3x3",
    );

    expect(motor?.mountInterfaces).toHaveLength(4);
    expect(motor?.protectedVolumes).toHaveLength(0);
    expect(propeller?.protectedVolumes).toHaveLength(1);
    expect(bodyInterface?.mountInterfaces).toHaveLength(2);
    expect(bodyInterface?.protectedVolumes).toHaveLength(1);
    expect(DRONE_ARM_FOUNDATION_STUDY.assembly.preservedMounts).toHaveLength(6);
    expect(DRONE_ARM_FOUNDATION_STUDY.assembly.obstacleVolumes).toHaveLength(2);
  });

  it("projects component-local motor geometry into assembly coordinates", () => {
    const motor = DRONE_ARM_FOUNDATION_STUDY.components.find(
      (component) => component.id === "motor-2207",
    );
    const motorMountX = DRONE_ARM_FOUNDATION_STUDY.assembly.preservedMounts
      .filter((mount) => mount.id.includes("-motor-mount-"))
      .map((mount) => mount.position.x.value)
      .sort((left, right) => left - right);
    const propellerKeepOut = DRONE_ARM_FOUNDATION_STUDY.assembly.obstacleVolumes.find(
      (volume) => volume.id === "motor-east-propeller-swept-volume",
    );
    const loadRegion = DRONE_ARM_FOUNDATION_STUDY.study.loadCases[0].forces[0].region;

    expect(motor?.geometryCoordinates).toBe("component-local");
    expect(DRONE_ARM_FOUNDATION_STUDY.assembly.geometryCoordinates).toBe("assembly");
    expect(DRONE_ARM_FOUNDATION_STUDY.study.geometryCoordinates).toBe("assembly");
    expect(motorMountX).toEqual([
      expect.closeTo(0.099343, 12),
      expect.closeTo(0.099343, 12),
      expect.closeTo(0.110657, 12),
      expect.closeTo(0.110657, 12),
    ]);
    expect(propellerKeepOut?.center.x).toEqual({ value: 0.105, unit: "m" });
    expect(loadRegion.center.x).toEqual({ value: 0.105, unit: "m" });
    expect(loadRegion.center.z).toEqual({ value: 0.003, unit: "m" });
  });
});
