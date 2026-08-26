import { expect, test } from "vitest";

import { defineAssemblyDraft } from "./assembly-model";

const mm = (value: number) => ({ value, unit: "mm" as const });
const degrees = (value: number) => ({ value, unit: "deg" as const });
const origin = { x: mm(0), y: mm(0), z: mm(0) };
const orientation = { roll: degrees(0), pitch: degrees(0), yaw: degrees(0) };

test("defines an immutable assembly-coordinate draft", async () => {
  const draft = await defineAssemblyDraft({
    id: "motor-arm",
    geometryCoordinates: "assembly",
    components: [{
      instanceId: "motor",
      componentRevision: "a".repeat(64),
      quantity: 1,
      transform: { position: origin, orientation },
    }],
    targetEnvelope: {
      kind: "box",
      id: "target",
      center: origin,
      size: { x: mm(100), y: mm(30), z: mm(10) },
    },
    preservedMounts: [],
    obstacleVolumes: [],
    accessVolumes: [],
    missingComponents: [],
    incompatibleComponents: [],
    ambiguousComponents: [],
  });

  expect(draft.geometryCoordinates).toBe("assembly");
  expect(Object.isFrozen(draft)).toBe(true);
});
