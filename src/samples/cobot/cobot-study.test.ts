import { describe, expect, it } from "vitest";

import { createAssemblyAuthoringState } from "../../assembly/assembly-authoring";
import { compileAssemblyTopologyContext } from "../../optimization/assembly-study-compiler";
import { SE6_CATALOG } from "./cobot-catalog";
import { se6Assembly } from "./cobot-assembly";
import { SE6_DISTAL_CENTER_M, SE6_DISTAL_MASS_KG, se6Study } from "./cobot-study";

describe("SE-6 upper-arm study", () => {
  it("derives three named structural cases from the modeled distal assembly", async () => {
    const workspace = await createAssemblyAuthoringState(se6Assembly, SE6_CATALOG);
    const context = compileAssemblyTopologyContext(workspace, se6Study);
    const cases = Object.fromEntries(context.input.loadCases.map((loadCase) => [loadCase.id, loadCase]));
    const totalForce = (id: string) => cases[id]!.loads.reduce((sum, { forceN }) =>
      sum.map((value, axis) => value + forceN[axis]!) as [number, number, number], [0, 0, 0] as [number, number, number]);

    expect(context.input.loadCases.map(({ id }) => id)).toEqual([
      "rated-payload-gravity", "emergency-stop", "lateral-disturbance",
    ]);
    expect(totalForce("rated-payload-gravity")).toEqual([
      0, 0, -SE6_DISTAL_MASS_KG * 9.80665,
    ]);
    expect(totalForce("emergency-stop")).toEqual([
      -SE6_DISTAL_MASS_KG * 2 * 9.80665, 0, -SE6_DISTAL_MASS_KG * 9.80665,
    ]);
    expect(totalForce("lateral-disturbance")).toEqual([
      0, 150, -SE6_DISTAL_MASS_KG * 9.80665,
    ]);
    expect(SE6_DISTAL_CENTER_M[0]).toBeGreaterThan(0.5);
  });

  it("normalizes the complete upper-arm contract to SI units", async () => {
    const workspace = await createAssemblyAuthoringState(se6Assembly, SE6_CATALOG);
    const { input, grid } = compileAssemblyTopologyContext(workspace, se6Study);

    expect(grid.dimensions).toEqual({ width: 48, height: 32, depth: 16 });
    expect(input.grid.cellSizeM).toEqual([0.0075, 0.13 / 32, 0.11 / 16]);
    expect(input.designDomain).toEqual([
      expect.objectContaining({ kind: "box", centerM: [0.21, 0, 0.34], sizeM: [0.36, 0.13, 0.11] }),
    ]);
    expect(input.requiredSolids).toHaveLength(8);
    expect(input.protectedVoids).toEqual([
      expect.objectContaining({ kind: "box", centerM: [0.21, 0, 0.34], sizeM: [0.27, 0.028, 0.028] }),
    ]);
    expect(input.accessVoids).toHaveLength(4);
    expect(input.assemblyMassKg).toBeCloseTo(24.3, 9);
    expect(input.centerOfMassM[0]).toBeGreaterThan(0.2);
    expect(input.material).toEqual({ youngsModulusPa: 1_700_000_000, failureStressPa: 45_000_000 });
  });
});
