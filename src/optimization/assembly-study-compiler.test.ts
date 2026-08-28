import { describe, expect, it } from "vitest";

import { createAssemblyAuthoringState } from "../assembly/assembly-authoring";
import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import { compileAssemblyTopologyContext } from "./assembly-study-compiler";

describe("compileAssemblyTopologyContext", () => {
  it("preserves explicit study domains, support regions, and named loads", async () => {
    const fixture = DRONE_ARM_FOUNDATION_STUDY;
    const state = await createAssemblyAuthoringState(fixture.assembly, fixture.components);

    const context = compileAssemblyTopologyContext(state, fixture.study);

    expect(context.input.designDomain).toHaveLength(1);
    expect(context.input.supports).toEqual([
      expect.objectContaining({ kind: "box", centerM: [0, 0, 0.003] }),
    ]);
    expect(context.input.loadCases).toEqual([
      expect.objectContaining({
        id: "maximum-thrust",
        loads: [expect.objectContaining({ forceN: [0, 0, -18] })],
      }),
    ]);
    expect(context.input.inertialRelief).toBe(false);
  });
});
