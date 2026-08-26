import { expect, test } from "vitest";

import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import { defineComponent as focusedDefineComponent } from "./component-model";
import {
  defineComponent,
  defineAssembly,
  MountInterfaceSchema,
  StudySpecSchema,
  VolumeSchema,
} from "./design";

const length = (value: number) => ({ value, unit: "mm" as const });
const center = { x: length(0), y: length(0), z: length(0) };
const orientation = { roll: { value: 0, unit: "deg" }, pitch: { value: 0, unit: "deg" }, yaw: { value: 0, unit: "deg" } };

test.each([0, -1])("rejects a %s box physical extent", (value) => {
  expect(VolumeSchema.safeParse({
    kind: "box", id: "box", center,
    size: { x: length(value), y: length(1), z: length(1) },
  }).success).toBe(false);
});

test.each([
  ["radius", { radius: length(0), height: length(1) }],
  ["height", { radius: length(1), height: length(-1) }],
] as const)("rejects a non-positive cylinder %s", (_name, extents) => {
  expect(VolumeSchema.safeParse({
    kind: "cylinder", id: "cylinder", center, orientation, ...extents,
  }).success).toBe(false);
});

test("rejects a non-positive mount diameter", () => {
  expect(MountInterfaceSchema.safeParse({
    id: "mount", position: center, orientation, diameter: length(0), fastenerType: "M3",
  }).success).toBe(false);
});

test("re-exports the shared SI constructors and canonical fixture snapshots", () => {
  expect(defineComponent).toBe(focusedDefineComponent);
  expect(DRONE_ARM_FOUNDATION_STUDY.components[0]?.mass).toEqual({ value: 0.038, unit: "kg" });
  expect(DRONE_ARM_FOUNDATION_STUDY.assembly.components[0]?.transform.position.x)
    .toEqual({ value: 0.105, unit: "m" });
  expect(defineAssembly).toBeDefined();
});

test.each([
  ["minimum feature", "minimumFeature", 0],
  ["minimum feature", "minimumFeature", -1],
  ["maximum displacement", "maximumDisplacement", 0],
  ["maximum displacement", "maximumDisplacement", -1],
] as const)("rejects a non-positive %s magnitude", (_label, field, value) => {
  const source = DRONE_ARM_FOUNDATION_STUDY.study;
  const candidate = field === "minimumFeature"
    ? { ...source, manufacturing: { ...source.manufacturing, minimumFeature: length(value) } }
    : { ...source, hardLimits: { maximumDisplacement: length(value) } };

  expect(StudySpecSchema.safeParse(candidate).success).toBe(false);
});
