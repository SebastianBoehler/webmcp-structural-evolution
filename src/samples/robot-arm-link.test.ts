import { describe, expect, it } from "vitest";

import { compileAssemblyTopologyContext } from "../optimization/assembly-study-compiler";
import { inspectAssemblyConflicts } from "../assembly/assembly-conflicts";
import { solveAssemblyConstraints } from "../assembly/assembly-authoring";
import { ROBOT_ARM_LINK_FIXTURE } from "./robot-arm-link";

describe("ROBOT_ARM_LINK_FIXTURE", () => {
  it("compiles a non-drone assembly with two named structural load cases", () => {
    const { workspace, study } = ROBOT_ARM_LINK_FIXTURE;
    const context = compileAssemblyTopologyContext(workspace, study);

    expect(workspace.draft.components).toHaveLength(3);
    expect(new Set(workspace.catalog.map(({ category }) => category))).toEqual(new Set([
      "robotics/joint-interface",
      "robotics/payload",
    ]));
    expect(context.input.motorMounts).toEqual([]);
    expect(context.input.loadCases.map(({ id }) => id)).toEqual(["payload-down", "emergency-side"]);
    expect(context.input.supports).toHaveLength(1);
    expect(context.input.accessVoids).toHaveLength(2);
    expect(inspectAssemblyConflicts(workspace.draft, workspace.catalog, ROBOT_ARM_LINK_FIXTURE.inventory)).toEqual([]);
    expect(solveAssemblyConstraints(workspace).constraintConflicts).toEqual([]);
  });
});
