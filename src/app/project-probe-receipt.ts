import type { JsonValue } from "../domain/canonical-json";
import type { ActionReceipt } from "../domain/receipts";
import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeMeasurement } from "../webmcp/schemas";

interface ProbeReceiptInput {
  readonly result: ProbeResult;
  readonly proposalRevision: string;
  readonly branchRevision: string;
  readonly attempt: number;
  readonly measurement: ProbeMeasurement;
}

export function probeReceiptOutcome({
  result,
  proposalRevision,
  branchRevision,
  attempt,
  measurement,
}: ProbeReceiptInput): ActionReceipt["outcome"] {
  if (result.status === "verified") {
    return {
      status: "succeeded",
      result: { proposalRevision, branchRevision, attempt, measurement: measurement as unknown as JsonValue },
    };
  }
  if (result.status === "estimate") {
    return {
      status: "succeeded",
      result: {
        proposalRevision,
        branchRevision,
        attempt,
        measurement: measurement as unknown as JsonValue,
        status: "estimate",
        truthLevel: "interactive-estimate",
      },
    };
  }
  if (result.status === "canceled") {
    return { status: "canceled", reason: measurement.message ?? "Topology optimization canceled" };
  }
  return { status: "failed", error: measurement.message ?? `${result.status} probe result` };
}
