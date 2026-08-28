import { expect, test } from "vitest";

import { DEMO_FIXTURES } from "./demo-fixtures";

test.each(Object.values(DEMO_FIXTURES))("$label exposes the exact compiled topology grid to agents", (fixture) => {
  const compiled = fixture.compileTopology(fixture.initialState);
  expect(fixture.context.grid).toEqual(compiled.grid);
  expect(fixture.context.selection.maxExclusive).toEqual([
    compiled.grid.dimensions.width,
    compiled.grid.dimensions.height,
    compiled.grid.dimensions.depth,
  ]);
});

test("robot fixture exposes its real fixed region rather than a drone body lock", () => {
  expect(DEMO_FIXTURES["robot-arm-link"].context.locks).toEqual(["base-support"]);
});
