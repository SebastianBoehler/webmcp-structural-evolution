import { describe, expect, it } from "vitest";

import { componentStructuralStudyAssignments } from "./component-structural-showcase";

describe("component structural showcase assignment", () => {
  it("keeps drone topology out while assigning SE-6 structural and topology", () => {
    expect(componentStructuralStudyAssignments()).toEqual({
      drone: { structuralStudyId: "drone-arm-structural" },
      cobot: {
        structuralStudyId: "se6-upper-arm-structural",
        topologyStudyId: "se6-upper-arm-topology",
      },
    });
  });
});
