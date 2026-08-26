import { revisionId } from "../domain/revisions";
import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { FOUNDATION_PROBE_DIMENSIONS, FOUNDATION_PROBE_WIDTH } from "../gpu/foundation-probe-config";
import type { ProbeMeasurement, RunFoundationProbeInput } from "../webmcp/schemas";

export function buildProbeInput(variant: RunFoundationProbeInput["variant"]): ProbeInput {
  const width = FOUNDATION_PROBE_WIDTH;
  const values = new Float32Array(width ** 3);
  for (let index = 0; index < values.length; index += 1) {
    const x = index % width;
    const normalized = (index % 97) / 96;
    const edge = Math.abs(x - (width - 1) / 2) / ((width - 1) / 2);
    values[index] = Math.fround(variant === "baseline"
      ? normalized
      : variant === "edge-biased"
        ? normalized * (0.5 + edge * 0.5)
        : normalized * (1 - edge * 0.5));
  }
  return { dimensions: FOUNDATION_PROBE_DIMENSIONS, values };
}

export function storeProbeResult(result: ProbeResult): ProbeResult {
  if (result.status === "verified") {
    return {
      status: "verified",
      output: new Float32Array(result.output),
      elapsedMs: result.elapsedMs,
      relativeL2: result.relativeL2,
      tolerance: result.tolerance,
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
    resultDigest,
    ...(result.status !== "verified" ? { code: result.code, message: result.message } : {}),
  };
}
