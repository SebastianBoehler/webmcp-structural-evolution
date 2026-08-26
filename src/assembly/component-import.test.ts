import { expect, test } from "vitest";

import { ComponentImportSchema } from "./component-import";

test("component imports require bounded engineering metadata and HTTPS sources", () => {
  const valid = {
    name: "XRotor reference",
    category: "motor",
    manufacturer: "Hobbywing",
    partNumber: "XRotor-2207.5SL-1780KV",
    assetUrl: "https://example.com/xrotor.glb",
    assetUnits: "mm",
    sourceUrl: "https://www.hobbywing.com/en/products/xrotor-22075",
    massG: 38,
    sizeMm: [28, 28, 31.9],
  };

  expect(ComponentImportSchema.parse(valid)).toEqual(valid);
  expect(() => ComponentImportSchema.parse({ ...valid, assetUrl: "http://example.com/motor.glb" })).toThrow(/https/i);
  expect(() => ComponentImportSchema.parse({ ...valid, sizeMm: [28, 28] })).toThrow();
});
