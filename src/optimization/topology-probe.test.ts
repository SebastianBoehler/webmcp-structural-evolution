import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProbeInput } from "../gpu/probe-contract";

const reference = vi.hoisted(() => ({ optimize: vi.fn() }));
vi.mock("../reference", () => ({ optimizeTopology: reference.optimize }));

const input = (topologyPreset: ProbeInput["topologyPreset"]): ProbeInput => ({
  dimensions: { width: 25, height: 25, depth: 5 },
  values: new Float32Array(25 * 25 * 5),
  topologyPreset,
});

describe("runTopologyProbe", () => {
  beforeEach(() => {
    reference.optimize.mockReset().mockResolvedValue({
      dimensions: { width: 25, height: 25, depth: 5 },
      density: new Float32Array(25 * 25 * 5).fill(0.36),
      displacement: new Float32Array(25 * 25 * 5).fill(0.1),
      stress: new Float32Array(25 * 25 * 5).fill(2),
      cases: {
        "collective-thrust": {
          displacement: new Float32Array(25 * 25 * 5).fill(0.1),
          stress: new Float32Array(25 * 25 * 5).fill(2),
        },
      },
      metrics: {
        initialCompliance: 100,
        finalCompliance: 42,
        maxDisplacement: 0.8,
        materialFraction: 0.36,
        iterations: 16,
      },
    });
  });

  it("returns genuine structural metrics with the verified density field", async () => {
    const { runTopologyProbe } = await import("./topology-probe");

    const result = await runTopologyProbe(input("balanced"));

    expect(reference.optimize).toHaveBeenCalledWith("balanced", undefined);
    expect(result).toMatchObject({
      status: "verified",
      topology: {
        solver: "sparse-simp-lattice-wasm",
        initialCompliance: 100,
        finalCompliance: 42,
        maxDisplacement: 0.8,
        materialFraction: 0.36,
        iterations: 16,
      },
    });
  });

  it("honors cancellation before entering Wasm", async () => {
    const { runTopologyProbe } = await import("./topology-probe");
    const controller = new AbortController();
    controller.abort();

    await expect(runTopologyProbe(input("lightweight"), controller.signal)).resolves.toMatchObject({
      status: "canceled",
    });
    expect(reference.optimize).not.toHaveBeenCalled();
  });

  it("fails closed when the solver result does not match the configured grid", async () => {
    const { runTopologyProbe } = await import("./topology-probe");
    reference.optimize.mockResolvedValueOnce({
      dimensions: { width: 2, height: 2, depth: 1 },
      density: new Float32Array(4),
      displacement: new Float32Array(4),
      stress: new Float32Array(4),
      cases: {},
      metrics: { initialCompliance: 1, finalCompliance: 1, maxDisplacement: 1, materialFraction: 1, iterations: 1 },
    });

    await expect(runTopologyProbe(input("stiffness"))).resolves.toMatchObject({
      status: "failed",
      code: "invalid-input",
    });
  });
});
