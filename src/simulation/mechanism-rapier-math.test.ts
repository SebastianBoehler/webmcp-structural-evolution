import { expect, test } from "vitest";

import { canonicalScalar } from "./mechanism-rapier-math";

test("canonicalizes signed-zero scalars at the Rapier boundary", () => {
  expect(Object.is(canonicalScalar(-0), -0)).toBe(false);
  expect(canonicalScalar(4.5)).toBe(4.5);
});
