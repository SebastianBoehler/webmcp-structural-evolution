import { describe, expect, it } from "vitest";

import { createDesignDocument } from "./document-schema";
import { applyPoint, resolveDocumentFrame } from "./rigid-transform";

describe("document rigid transforms", () => {
  it("resolves parented frame rotations before child translations", async () => {
    const base = await createDesignDocument({
      id: "frame-test", label: "Frame test",
      units: { length: "mm", angle: "deg", mass: "kg" },
      createdBy: { kind: "agent", id: "test" },
    });
    const document = {
      ...base,
      frames: [base.frames[0], {
        id: "parent", label: "Parent", parentId: "world",
        transform: {
          position: { x: { value: 1, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
          orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: Math.PI / 2, unit: "rad" } },
        },
      }, {
        id: "child", label: "Child", parentId: "parent",
        transform: {
          position: { x: { value: 2, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
          orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
        },
      }],
    } as never;

    const resolved = resolveDocumentFrame(document, "child");
    const origin = applyPoint(resolved, [0, 0, 0]);
    expect(origin[0]).toBeCloseTo(1, 14);
    expect(origin[1]).toBeCloseTo(2, 14);
    expect(origin[2]).toBe(0);
    expect(applyPoint(resolved, [1, 0, 0])[1]).toBeCloseTo(3, 14);
  });
});
