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

test("SE-6 fixture exposes its upper-arm study and detailed visual adapter", () => {
  const fixture = DEMO_FIXTURES["se6-cobot"];
  expect(fixture.context.locks).toEqual(["j2-upper-arm-support"]);
  expect(fixture.label).toBe("SE-6 six-axis cobot");
  expect(fixture.topologySubject).toBe("upper arm");
  expect(fixture.compileTopology(fixture.initialState).input.loadCases.map(({ id }) => id)).toEqual([
    "rated-payload-gravity", "emergency-stop", "lateral-disturbance",
  ]);
  expect(fixture.renderParts?.(fixture.initialState.draft, fixture.initialState.catalog, {})
    .filter(({ appearance }) => appearance === "component")).toHaveLength(52);
});
