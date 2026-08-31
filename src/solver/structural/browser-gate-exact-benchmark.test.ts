import { describe, expect, it } from "vitest";

import { BROWSER_BENCHMARKS } from "./browser-gate-exact-benchmark";

describe("live exact structural benchmark contract", () => {
  it("locks the strengthened cobot geometry without changing its load or acceptance limits", () => {
    const cobot = BROWSER_BENCHMARKS.find(({ id }) => id === "cobot");

    expect(cobot).toEqual({
      id: "cobot", sizeM: [.1, .03, .02], cellSizeM: .005,
      forceN: [0, -1_000, 0], topologyTarget: .75,
      topologyAcceptance: {
        maximumDisplacementM: .03, maximumVonMisesStressPa: 150e6,
        minimumSafetyFactor: 1.5, maximumMaterialFraction: .75,
      },
    });
  });
});
