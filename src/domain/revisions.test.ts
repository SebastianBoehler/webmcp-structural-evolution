import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical-json";
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

  it.each([
    ["undefined", undefined],
    ["non-finite number", Number.POSITIVE_INFINITY],
    ["Date", new Date("2026-08-26T00:00:00.000Z")],
    ["sparse array", Array(1)],
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
});
