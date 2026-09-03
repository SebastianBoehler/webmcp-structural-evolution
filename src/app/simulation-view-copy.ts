import type { ViewerBranch } from "../viewer/alternative-instances";

export function simulationCaseMaximumDisplacementM(
  branch: ViewerBranch | null,
): Readonly<Record<string, number>> | undefined {
  const result = branch?.result;
  if (!result || (result.status !== "estimate" && result.status !== "verified")) return undefined;
  return Object.fromEntries(Object.entries(result.analysis?.cases ?? {}).flatMap(([id, fields]) => {
    if (!fields) return [];
    return [[id, fields.displacement.reduce((maximum, value) => Math.max(maximum, value), 0)]];
  }));
}

export function simulationViewerStatus(
  active: boolean,
  supportsFlightReplay: boolean,
  estimate: boolean,
): string {
  if (estimate) return active && supportsFlightReplay
    ? "Replaying interactive estimate · linear-static interpolation · unverified and unaccepted"
    : "Interactive estimate · precomputed linear-static case · unverified and unaccepted";
  if (!supportsFlightReplay) return "Precomputed linear-static structural case";
  return active
    ? "Replaying precomputed linear-static case · interpolated field"
    : "Precomputed linear-static case · ready to replay";
}
