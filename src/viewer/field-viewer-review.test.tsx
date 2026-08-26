import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ViewerBranch } from "./alternative-instances";
import { FieldViewer } from "./FieldViewer";
import {
  alternative,
  current,
  grid,
  harness,
  region,
  renderedMeshes,
  verified,
} from "./field-viewer-test-support";

describe("FieldViewer reviewed boundaries", () => {
  afterEach(cleanup);

  it("never auditions an ambiguous duplicate ID through an incompatible raw branch", () => {
    const test = harness();
    const incompatible: ViewerBranch = {
      ...alternative,
      grid: { ...grid, anchor: { ...grid.anchor, position: [99, 7, 11] } },
      result: verified([1, 1, 1, 1]),
    };
    const duplicate = { ...alternative, result: verified([1, 0, 0, 0]) };

    render(
      <FieldViewer
        current={current}
        alternatives={[incompatible, duplicate]}
        selectedRegion={region}
        threshold={0.5}
        mode="audition"
        selectedAlternative="lighter"
        environment={test.environment}
      />,
    );

    expect(renderedMeshes(test)[0]?.count).toBe(3);
    expect(screen.getAllByRole("cell", { name: /duplicate.*not rendered/i })).toHaveLength(2);
  });

  it("shows every rejected branch while rendering a valid fourth branch", () => {
    const test = harness();
    const failed: ViewerBranch = {
      ...alternative,
      branchRevision: "failed-first",
      result: { status: "failed", code: "device-error", message: "lost", elapsedMs: 1 },
    };
    const shifted: ViewerBranch = {
      ...alternative,
      branchRevision: "shifted-second",
      grid: { ...grid, anchor: { ...grid.anchor, position: [6, 7, 11] as const } },
    };
    const wrongParent = { ...alternative, branchRevision: "wrong-third", parentRevision: "other" };
    const valid = { ...alternative, branchRevision: "valid-fourth" };

    render(
      <FieldViewer
        current={current}
        alternatives={[failed, shifted, wrongParent, valid]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        environment={test.environment}
      />,
    );

    expect(renderedMeshes(test)).toHaveLength(2);
    for (const id of ["failed-first", "shifted-second", "wrong-third", "valid-fourth"]) {
      expect(screen.getByRole("cell", { name: id })).toBeVisible();
    }
  });
});
