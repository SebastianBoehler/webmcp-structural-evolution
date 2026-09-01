import { z } from "zod";

import { revisionId } from "../domain/revisions";

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const consoleEvidence = z.object({
  statusLines: z.array(z.string().min(1)).min(1),
  warningCount: z.literal(0), errorCount: z.literal(0),
}).strict();

const passed = z.object({
  status: z.literal("passed"), evidenceSource: z.literal("live-browser-worker"),
  auditOnly: z.literal(true), authorizesEngineeringResult: z.literal(false),
  sessionId: digest, recordedAt: z.string().datetime(),
  ids: z.object({
    sourceRevision: digest, studyId: z.string().min(1), mechanismInputDigest: digest,
    resultDigest: digest, replayDigest: digest, replayArtifactId: digest,
    sourceArtifactIds: z.array(digest).min(1),
  }).strict(),
  runtime: z.object({
    engineVersion: z.string().min(1), runtimeVersion: z.string().min(1),
    runtimeDigest: digest, solverBuildDigest: digest, wasmModuleDigest: digest,
    workerArtifactDigest: digest, settingsDigest: digest,
  }).strict(),
  benchmark: z.object({
    bodyCount: z.literal(7), revoluteJointCount: z.literal(6),
    fixedBodyIds: z.tuple([z.literal("base")]), visualPartCount: z.literal(52),
    bodyGroupCount: z.literal(7), completeOwnership: z.literal(true),
    frameCount: z.number().int().positive(), durationSteps: z.number().int().positive(),
    outputStrideSteps: z.number().int().positive(), outputHz: finite.positive(),
  }).strict(),
  motion: z.object({
    maximumJointDeltaFromAuthoredPoseRad: z.record(z.string().min(1), finite),
    movingJointIds: z.array(z.string().min(1)).min(3),
    limitsRespected: z.literal(true), maximumJointErrorM: nonnegative.max(1e-5),
  }).strict(),
  collision: z.object({
    adjacentPairsDisabled: z.literal(true), nonAdjacentPairsEnabled: z.literal(true),
    maximumPenetrationM: nonnegative.max(1e-4), minimumRequestedClearanceM: finite,
    declaredClearancePairCount: z.number().int().positive(),
    clearanceSampleCount: z.number().int().positive(), contactEventCount: z.number().int().nonnegative(),
  }).strict(),
  cancellation: z.object({
    outcome: z.literal("cancelled"), lateTerminal: z.literal(false),
    artifactsCommitted: z.literal(0), recoveryRunPassed: z.literal(true),
    workerStarted: z.literal(true), cancellationRequestedAfterWorkerStart: z.literal(true),
    timingMs: nonnegative,
  }).strict(),
  timingsMs: z.object({ build: nonnegative, solveAndRecovery: nonnegative, total: nonnegative }).strict(),
  solverPhaseConsole: consoleEvidence,
}).strict().superRefine((value, context) => {
  const expectedFrames = value.benchmark.durationSteps / value.benchmark.outputStrideSteps + 1;
  if (value.benchmark.frameCount !== expectedFrames || value.benchmark.outputHz !== 60) {
    context.addIssue({ code: "custom", message: "Mechanism replay does not provide complete 60 Hz frame coverage" });
  }
  if (value.collision.clearanceSampleCount
      !== value.benchmark.frameCount * value.collision.declaredClearancePairCount) {
    context.addIssue({ code: "custom", message: "Mechanism clearance coverage is incomplete" });
  }
  if (new Set(value.motion.movingJointIds).size !== value.motion.movingJointIds.length
      || value.motion.movingJointIds.some((id) =>
        !(Math.abs(value.motion.maximumJointDeltaFromAuthoredPoseRad[id] ?? 0) > 1e-4))) {
    context.addIssue({ code: "custom", message: "Mechanism motion must exercise at least three distinct axes" });
  }
});

const blocked = z.object({
  status: z.literal("blocked"), evidenceSource: z.literal("live-browser-worker"),
  blocker: z.object({ stage: z.string().min(1), message: z.string().min(1) }).strict(),
  solverPhaseConsole: z.object({
    statusLines: z.array(z.string().min(1)), warningCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type MechanismBrowserGateReport = z.infer<typeof passed> | z.infer<typeof blocked>;
export type PassedMechanismBrowserGateReport = z.infer<typeof passed>;

export function parseMechanismBrowserGateReport(value: unknown): MechanismBrowserGateReport {
  if (!value || typeof value !== "object") throw new Error("Mechanism browser gate report is invalid");
  return (value as { status?: unknown }).status === "passed" ? passed.parse(value) : blocked.parse(value);
}

export async function sealMechanismBrowserGateReport(
  content: Omit<PassedMechanismBrowserGateReport, "sessionId">,
): Promise<PassedMechanismBrowserGateReport> {
  return passed.parse({ ...content, sessionId: await revisionId(content) });
}

export async function verifyMechanismBrowserGateReportDigest(
  report: MechanismBrowserGateReport,
): Promise<boolean> {
  if (report.status !== "passed") return false;
  const { sessionId, ...content } = report;
  return sessionId === await revisionId(content);
}
