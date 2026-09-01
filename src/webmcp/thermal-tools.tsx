import { useMemo } from "react";

import type { ThermalBrowserGateSession } from "../solver/thermal/browser-thermal-gate";
import { useFoundationTools } from "./use-foundation-tools";
import type { ModelContextTool, WebMCPToolResponse } from "./protocol";

export interface ThermalGateService {
  run(signal: AbortSignal): Promise<ThermalBrowserGateSession>;
}

const schema = { type: "object", additionalProperties: false, properties: {} } as const;
function response(session: ThermalBrowserGateSession): WebMCPToolResponse {
  const report = session.report;
  const facts = report.status === "passed" ? {
    status: report.status, reportDigest: report.reportDigest,
    sourceRevision: report.sourceRevision, sourceArtifactIds: report.sourceArtifactIds,
    studyId: report.studyId, boundaries: report.boundaries,
    device: report.device, solve: report.solve, verification: report.verification,
    artifactIds: report.artifacts.map(({ artifactId }) => artifactId),
  } : { status: report.status, reportDigest: report.reportDigest, blocker: report.blocker };
  return { content: [{ type: "text", text: JSON.stringify(facts) }],
    ...(report.status === "blocked" ? { isError: true } : {}) };
}

export function thermalToolDefinition(service: ThermalGateService): ModelContextTool {
  return {
    name: "run_cobot_thermal_study",
    description: "Run the exact SE-6 cobot steady-thermal study through live WebGPU, persisted job artifacts, and independent Wasm verification.",
    inputSchema: schema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(_input, options) {
      try { return response(await service.run(options?.signal ?? new AbortController().signal)); }
      catch (error) { return { isError: true, content: [{ type: "text", text: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }) }] }; }
    },
  };
}

export function ThermalTools({ service }: { readonly service: ThermalGateService }) {
  const definitions = useMemo(() => {
    const definition = thermalToolDefinition(service);
    return [{ ...definition, enabled: true, annotations: {
      readOnlyHint: false, untrustedContentHint: true as const,
    } }];
  }, [service]);
  const registration = useFoundationTools(definitions);
  return <p className="thermal-gate__tool-status" role="status">
    {registration.supported
      ? `${registration.registered} of 1 thermal tools registered.`
      : "WebMCP thermal tool is unavailable in this browser context."}
    {registration.errors.map((error) => <span role="alert" key={error}>{error}</span>)}
  </p>;
}
