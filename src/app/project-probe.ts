import { revisionId } from "../domain/revisions";
import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { TOPOLOGY_DIMENSIONS } from "../optimization/topology-config";
import type { LiveTopologyContext } from "../optimization/assembly-topology-input";
import type { ProbeMeasurement, RunFoundationProbeInput } from "../webmcp/schemas";

export function buildProbeInput(variant: RunFoundationProbeInput["variant"], live?: LiveTopologyContext): ProbeInput {
  const values = new Float32Array(TOPOLOGY_DIMENSIONS.width * TOPOLOGY_DIMENSIONS.height * TOPOLOGY_DIMENSIONS.depth);
  return {
    dimensions: live?.grid.dimensions ?? TOPOLOGY_DIMENSIONS,
    values: live ? new Float32Array(live.grid.dimensions.width * live.grid.dimensions.height * live.grid.dimensions.depth) : values,
    topologyPreset: variant === "lightweight" ? "lightweight"
      : variant === "stiffness" ? "stiffness" : "balanced",
    ...(live ? { assembly: live.input, topologyGrid: live.grid } : {}),
  };
}

export function storeProbeResult(result: ProbeResult): ProbeResult {
  if (result.status === "verified") {
    return {
      status: "verified",
      output: new Float32Array(result.output),
      elapsedMs: result.elapsedMs,
      relativeL2: result.relativeL2,
      tolerance: result.tolerance,
      ...(result.topology ? { topology: { ...result.topology } } : {}),
      ...(result.grid ? { grid: result.grid } : {}),
    };
  }
  if (result.status === "mismatch") {
    return {
      status: "mismatch",
      code: result.code,
      message: result.message,
      elapsedMs: result.elapsedMs,
      relativeL2: result.relativeL2,
      tolerance: result.tolerance,
    };
  }
  if (result.status === "canceled") return { ...result };
  return {
    status: "failed",
    code: result.code,
    message: result.message,
    elapsedMs: result.elapsedMs,
  };
}

export async function measuredProbe(result: ProbeResult): Promise<ProbeMeasurement> {
  let resultDigest: string;
  if (result.status === "verified") {
    const bytes = new Uint8Array(result.output.byteLength);
    bytes.set(new Uint8Array(result.output.buffer, result.output.byteOffset, result.output.byteLength));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    resultDigest = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  } else {
    resultDigest = await revisionId({
      status: result.status,
      code: result.code,
      elapsedMs: result.elapsedMs,
      ...(result.status === "mismatch" ? { relativeL2: result.relativeL2 } : {}),
    });
  }
  return {
    status: result.status,
    elapsedMs: result.elapsedMs,
    ...(result.status === "verified" || result.status === "mismatch"
      ? { relativeL2: result.relativeL2 }
      : {}),
    ...(result.status === "verified" && result.topology ? { topology: { ...result.topology } } : {}),
    resultDigest,
    ...(result.status !== "verified" ? { code: result.code, message: result.message } : {}),
  };
}
