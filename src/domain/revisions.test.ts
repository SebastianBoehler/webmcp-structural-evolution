import { describe, expect, it } from "vitest";

import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import { canonicalJson } from "./canonical-json";
import { defineComponent } from "./design";
import { revisionId } from "./revisions";

describe("canonicalJson", () => {
  it("sorts object keys recursively without reordering arrays", () => {
    expect(
      canonicalJson({
        z: [{ second: 2, first: 1 }, "kept-last"],
        a: true,
      }),
    ).toBe('{"a":true,"z":[{"first":1,"second":2},"kept-last"]}');
  });

  const indexedGetter = [1];
  Object.defineProperty(indexedGetter, 0, {
    configurable: true,
    enumerable: true,
    get: () => 1,
  });
  const symbolOwned = [1];
  Object.defineProperty(symbolOwned, Symbol("metadata"), { value: "hidden" });
  const propertyOwned = [1] as number[] & { metadata?: string };
  propertyOwned.metadata = "hidden";
  class ArraySubclass extends Array<number> {}
  const arraySubclass = new ArraySubclass();
  arraySubclass.push(1);

  it.each([
    ["undefined", undefined],
    ["non-finite number", Number.POSITIVE_INFINITY],
    ["Date", new Date("2026-08-26T00:00:00.000Z")],
    ["sparse array", Array(1)],
    ["indexed array getter", indexedGetter],
    ["array symbol key", symbolOwned],
    ["array non-index property", propertyOwned],
    ["array subclass", arraySubclass],
  ])("rejects unsupported JSON value: %s", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(/unsupported canonical json value/i);
  });
});

describe("revisionId", () => {
  it("is independent of object key insertion order", async () => {
    expect(await revisionId({ b: 2, a: 1 })).toBe(
      await revisionId({ a: 1, b: 2 }),
    );
  });

  it("preserves unit identity in component revisions", async () => {
    expect(await revisionId({ mass: { value: 24, unit: "g" } })).not.toBe(
      await revisionId({ mass: { value: 24, unit: "kg" } }),
    );
  });

  it("content-addresses each immutable fixture snapshot", async () => {
    const snapshots = [
      ...DRONE_ARM_FOUNDATION_STUDY.components,
      DRONE_ARM_FOUNDATION_STUDY.assembly,
      DRONE_ARM_FOUNDATION_STUDY.study,
    ];

    for (const snapshot of snapshots) {
      const { revision, ...content } = snapshot;
      expect(revision).toBe(await revisionId(content));
    }
  });

  it("rejects changed component content that reuses a revision", async () => {
    const component = DRONE_ARM_FOUNDATION_STUDY.components[0];

    await expect(
      defineComponent({
        ...component,
        mass: { value: component.mass.value + 1, unit: component.mass.unit },
      }),
    ).rejects.toThrow(/revision does not match canonical content/i);
  });
});
