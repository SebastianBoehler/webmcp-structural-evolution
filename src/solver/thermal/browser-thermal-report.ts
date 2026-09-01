import { z } from "zod";

import { revisionId } from "../../domain/revisions";

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const gridDimension = z.number().int().positive().max(262_144);
const passedContent = z.object({
  status: z.literal("passed"), evidenceSource: z.literal("live-browser-webgpu-wasm"),
  recordedAt: z.string().datetime(), sourceRevision: digest,
  sourceArtifactIds: z.tuple([digest, digest, digest]),
  studyId: z.literal("se6-upper-arm-thermal"),
  device: z.object({ vendor: z.string(), architecture: z.string() }).strict(),
  grid: z.object({ cellDimensions: z.tuple([gridDimension, gridDimension, gridDimension]),
    activeCellCount: z.number().int().positive().max(262_144) }).strict(),
  boundaries: z.object({
    mounting: z.object({ selectedAreaM2: z.literal(.0064), representedAreaM2: finite.positive(),
      relativeAreaError: nonnegative.max(.02) }).strict(),
    motor: z.object({ selectedAreaM2: z.literal(.0064), representedAreaM2: finite.positive(),
      relativeAreaError: nonnegative.max(.02) }).strict(),
    heatInputW: z.literal(80),
  }).strict(),
  solve: z.object({ iterations: z.number().int().nonnegative().max(4_096),
    relativeResidual: nonnegative.max(1e-6), relativeEnergyImbalance: nonnegative.max(1e-3),
    minimumTemperatureK: finite.positive(), maximumTemperatureK: finite.positive() }).strict(),
  verification: z.object({ temperatureRelativeL2: nonnegative.max(1e-3),
    fieldRelativeL2: nonnegative.max(2e-3), heatRateRelativeError: nonnegative.max(2e-3),
    relativeEnergyImbalance: nonnegative.max(1e-3) }).strict(),
  cancellation: z.object({ outcome: z.literal("cancelled"), terminalCount: z.literal(1),
    artifactsCommitted: z.literal(0), recoveryRunPassed: z.literal(true) }).strict(),
  artifacts: z.array(z.object({ artifactId: digest, contentDigest: digest,
    mediaType: z.string().min(1), persisted: z.literal(true) }).strict()).length(3),
  timingsMs: z.object({ build: nonnegative, solve: nonnegative, total: nonnegative }).strict(),
}).strict().superRefine((value, context) => {
  if (value.grid.activeCellCount > value.grid.cellDimensions.reduce((product, size) => product * size, 1)) {
    context.addIssue({ code: "custom", message: "Thermal active-cell evidence exceeds the reported grid" });
  }
  if (value.solve.maximumTemperatureK < value.solve.minimumTemperatureK) {
    context.addIssue({ code: "custom", message: "Thermal temperature range is inverted" });
  }
  if (!value.artifacts.some(({ mediaType }) => mediaType.endsWith("quantity=temperature"))
    || !value.artifacts.some(({ mediaType }) => mediaType.endsWith("quantity=heat-flux"))) {
    context.addIssue({ code: "custom", message: "Thermal field artifacts are incomplete" });
  }
});

const passed = passedContent.extend({ reportDigest: digest }).strict();
const blocked = z.object({
  status: z.literal("blocked"), evidenceSource: z.literal("live-browser-webgpu-wasm"),
  reportDigest: digest, recordedAt: z.string().datetime(),
  blocker: z.object({ stage: z.string().min(1), message: z.string().min(1) }).strict(),
}).strict();

export type PassedThermalBrowserGateReport = z.infer<typeof passed>;
export type ThermalBrowserGateReport = PassedThermalBrowserGateReport | z.infer<typeof blocked>;

export async function sealThermalBrowserGateReport(
  content: z.input<typeof passedContent>,
): Promise<PassedThermalBrowserGateReport> {
  const parsed = passedContent.parse(content);
  return passed.parse({ ...parsed, reportDigest: await revisionId(parsed) });
}

export async function blockThermalBrowserGateReport(stage: string, error: unknown) {
  const content = { status: "blocked" as const, evidenceSource: "live-browser-webgpu-wasm" as const,
    recordedAt: new Date().toISOString(), blocker: {
      stage, message: error instanceof Error ? error.message : String(error),
    } };
  return blocked.parse({ ...content, reportDigest: await revisionId(content) });
}

export async function verifyThermalBrowserGateReportDigest(report: ThermalBrowserGateReport) {
  const { reportDigest, ...content } = report;
  return reportDigest === await revisionId(content);
}
