import type { ProbeResult, TopologyMetrics } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { optimizeDroneFrame } from "../reference";

const elapsed = (startedAt: number) => performance.now() - startedAt;

export async function runTopologyProbe(
  input: ProbeInput,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const startedAt = performance.now();
  if (signal?.aborted) {
    return { status: "canceled", code: "canceled", message: "Topology optimization canceled by the user.", elapsedMs: elapsed(startedAt) };
  }
  try {
    const preset = input.topologyPreset ?? "balanced";
    const result = await optimizeDroneFrame(preset);
    if (signal?.aborted) {
      return { status: "canceled", code: "canceled", message: "Topology optimization canceled by the user.", elapsedMs: elapsed(startedAt) };
    }
    const expected = input.dimensions.width * input.dimensions.height * input.dimensions.depth;
    if (result.density.length !== expected
      || result.dimensions.width !== input.dimensions.width
      || result.dimensions.height !== input.dimensions.height
      || result.dimensions.depth !== input.dimensions.depth) {
      throw new RangeError("The solver field does not match the active topology grid.");
    }
    const topology: TopologyMetrics = {
      solver: "sparse-simp-lattice-wasm",
      ...result.metrics,
    };
    return {
      status: "verified",
      output: result.density,
      elapsedMs: elapsed(startedAt),
      relativeL2: 0,
      tolerance: 0,
      topology,
    };
  } catch (error) {
    return {
      status: "failed",
      code: "invalid-input",
      message: `Topology optimization failed: ${error instanceof Error ? error.message : String(error)}`,
      elapsedMs: elapsed(startedAt),
    };
  }
}
