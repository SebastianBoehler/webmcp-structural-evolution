import { describe, expect, it } from "vitest";

import { evaluateInventory } from "../domain/design";
import { DRONE_ARM_FOUNDATION_STUDY } from "./drone-arm-foundation";

describe("DRONE_ARM_FOUNDATION_STUDY", () => {
  it("reports the exact M3 fastener stock shortfall", () => {
    expect(
      evaluateInventory(
        DRONE_ARM_FOUNDATION_STUDY.inventory,
        DRONE_ARM_FOUNDATION_STUDY.assembly,
      ),
    ).toEqual({
      status: "insufficient-stock",
      shortages: [
        {
          componentRevision: "component:m3-fastener:rev-1",
          requiredQuantity: 4,
          ownedQuantity: 3,
          shortfall: 1,
        },
      ],
    });
  });

  it("does not label an unresolved assembly buildable", () => {
    const completeInventory = DRONE_ARM_FOUNDATION_STUDY.inventory.map((item) =>
      item.componentRevision === "component:m3-fastener:rev-1"
        ? { ...item, ownedQuantity: 4 }
        : item,
    );
    const unresolvedAssembly = {
      ...DRONE_ARM_FOUNDATION_STUDY.assembly,
      ambiguousComponents: ["component:motor-2207:rev-1"],
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

    expect(motor?.mountInterfaces).toHaveLength(4);
    expect(motor?.keepOutVolumes).toHaveLength(1);
    expect(bodyInterface?.mountInterfaces).toHaveLength(2);
    expect(bodyInterface?.keepOutVolumes).toHaveLength(1);
    expect(DRONE_ARM_FOUNDATION_STUDY.assembly.preservedMounts).toHaveLength(6);
    expect(DRONE_ARM_FOUNDATION_STUDY.assembly.obstacleVolumes).toHaveLength(2);
  });
});
