import { describe, expect, it } from "vitest";

import {
  parseMechanismBrowserGateReport, sealMechanismBrowserGateReport,
  verifyMechanismBrowserGateReportDigest,
} from "./browser-mechanism-report";

const id = (digit: string) => digit.repeat(64);
const content = () => ({
  status: "passed" as const, evidenceSource: "live-browser-worker" as const,
  auditOnly: true as const, authorizesEngineeringResult: false as const,
  recordedAt: "2026-09-01T12:00:00.000Z",
  ids: { sourceRevision: id("1"), studyId: "se6-motion", mechanismInputDigest: id("2"),
    resultDigest: id("3"), replayDigest: id("4"), replayArtifactId: id("5"),
    sourceArtifactIds: [id("6"), id("7")] },
  runtime: { engineVersion: "0.18.1", runtimeVersion: "rapier", runtimeDigest: id("8"),
    solverBuildDigest: id("9"), wasmModuleDigest: id("a"), workerArtifactDigest: id("b"),
    settingsDigest: id("c") },
  benchmark: { bodyCount: 7 as const, revoluteJointCount: 6 as const,
    fixedBodyIds: ["base"] as ["base"], visualPartCount: 52 as const, bodyGroupCount: 7 as const,
    completeOwnership: true as const, frameCount: 61, durationSteps: 240,
    outputStrideSteps: 4, outputHz: 60 },
  motion: { maximumJointDeltaFromAuthoredPoseRad: { j1: .2, j2: -.1, j3: .03 },
    movingJointIds: ["j1", "j2", "j3"],
    limitsRespected: true as const, maximumJointErrorM: 2e-7 },
  collision: { adjacentPairsDisabled: true as const, nonAdjacentPairsEnabled: true as const,
    maximumPenetrationM: 2e-6, minimumRequestedClearanceM: -.000002,
    declaredClearancePairCount: 5, clearanceSampleCount: 305, contactEventCount: 2 },
  cancellation: { outcome: "cancelled" as const, lateTerminal: false as const,
    artifactsCommitted: 0 as const, recoveryRunPassed: true as const, workerStarted: true as const,
    cancellationRequestedAfterWorkerStart: true as const, timingMs: 12 },
  timingsMs: { build: 10, solveAndRecovery: 20, total: 30 },
  solverPhaseConsole: { statusLines: ["passed"], warningCount: 0 as const, errorCount: 0 as const },
});

describe("mechanism browser gate report", () => {
  it("seals complete 60 Hz six-axis evidence as audit-only", async () => {
    const report = await sealMechanismBrowserGateReport(content());
    expect(parseMechanismBrowserGateReport(report)).toEqual(report);
    expect(await verifyMechanismBrowserGateReportDigest(report)).toBe(true);
    expect(report.authorizesEngineeringResult).toBe(false);
  });

  it("rejects incomplete axis, clearance, and solver-phase console evidence", async () => {
    const report = await sealMechanismBrowserGateReport(content());
    expect(() => parseMechanismBrowserGateReport({ ...report,
      motion: { ...report.motion, movingJointIds: ["j1", "j2"] } })).toThrow();
    expect(() => parseMechanismBrowserGateReport({ ...report,
      collision: { ...report.collision, clearanceSampleCount: 304 } })).toThrow(/coverage/i);
    expect(() => parseMechanismBrowserGateReport({ ...report,
      solverPhaseConsole: { ...report.solverPhaseConsole, errorCount: 1 } })).toThrow();
    expect(() => parseMechanismBrowserGateReport({ ...report,
      cancellation: { ...report.cancellation, workerStarted: false } })).toThrow();
  });

  it("cannot serialize a zero browser-UI console claim after a renderer error", async () => {
    const report = await sealMechanismBrowserGateReport(content());
    expect(() => parseMechanismBrowserGateReport({ ...report,
      browserUiConsole: { warningCount: 0, errorCount: 0,
        observation: "renderer threw during first playback frame" } })).toThrow();
    expect(report).not.toHaveProperty("browserUiConsole");
  });
});
