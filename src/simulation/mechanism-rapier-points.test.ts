import * as RAPIER from "@dimforge/rapier3d-deterministic-compat";
import { beforeAll, expect, test, vi } from "vitest";

import { bindPointForces, applyPointForces } from "./mechanism-rapier-points";
import { createRapierState } from "./mechanism-rapier-world";
import { mechanismSolverInput } from "./mechanism-solver.test-support";

beforeAll(async () => { await RAPIER.init(); });

test("resolves each configured point force once before the simulation loop", async () => {
  const input = await mechanismSolverInput({ pointForces: [
    { bodyId: "link", pointLocalM: [1, 0, 0], forceWorldN: [1, 0, 0] },
  ], durationSteps: 1_000, outputStrideSteps: 1_000 });
  const state = createRapierState(RAPIER, input);
  const bodyLookup = vi.spyOn(state.bodies, "get");
  try {
    const forces = bindPointForces(input, state);
    expect(bodyLookup).toHaveBeenCalledTimes(1);
    bodyLookup.mockClear();
    for (let step = 0; step < input.durationSteps; step += 1) applyPointForces(forces);
    expect(bodyLookup).not.toHaveBeenCalled();
  } finally { state.world.free(); }
});
