import { revisionId } from "../domain/revisions";
import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { TOPOLOGY_DIMENSIONS } from "../optimization/topology-config";
import type { ProbeMeasurement, RunFoundationProbeInput } from "../webmcp/schemas";

export function buildProbeInput(variant: RunFoundationProbeInput["variant"]): ProbeInput {
  const values = new Float32Array(TOPOLOGY_DIMENSIONS.width * TOPOLOGY_DIMENSIONS.height * TOPOLOGY_DIMENSIONS.depth);
  return {
    dimensions: TOPOLOGY_DIMENSIONS,
    values,
    topologyPreset: variant === "lightweight" ? "lightweight"
      : variant === "stiffness" ? "stiffness" : "balanced",
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
