/// <reference lib="webworker" />

import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { runTopologyProbe } from "./topology-probe";

interface WorkerRequest {
  readonly input: ProbeInput;
}

function transferables(result: ProbeResult): Transferable[] {
  if (result.status !== "verified") return [];
  const caseBuffers = result.analysis?.cases
    ? Object.values(result.analysis.cases).flatMap((fields) => fields
      ? [fields.displacement.buffer, fields.stress.buffer]
      : [])
    : [];
  return [
    result.output.buffer,
    ...(result.analysis ? [result.analysis.displacement.buffer, result.analysis.stress.buffer] : []),
    ...caseBuffers,
  ];
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  const result = await runTopologyProbe(data.input);
  self.postMessage({ result }, { transfer: transferables(result) });
};

export {};
