import type { JsonValue } from "../domain/canonical-json";
import type { ActionReceipt } from "../domain/receipts";
import type { ProbeResult } from "../gpu/compute-probe";
import type {
  FoundationBranch,
  FoundationProjectState,
  RunFoundationProbeInput,
} from "../webmcp/schemas";
import { measuredProbe } from "./project-probe";
import { freezeValue } from "./project-state-copy";

interface MutableRef<T> {
  current: T;
}

export interface ActiveProbeOperation {
  readonly controller: AbortController;
  readonly input: RunFoundationProbeInput;
  readonly runStartedAt: number;
  branchRevision?: string;
  proposalRevision?: string;
  attempt?: number;
  cancellation?: Promise<FoundationBranch>;
  cancellationReason?: string;
  abandoned?: boolean;
  detachExternalAbort?: () => void;
}

interface CancellationDependencies {
  readonly stateRef: MutableRef<FoundationProjectState>;
  readonly operationRef: MutableRef<ActiveProbeOperation | null>;
  readonly commit: (next: FoundationProjectState) => FoundationProjectState;
  readonly addReceipt: (
    action: string,
    validatedInputs: JsonValue,
    affectedRevision: string,
    outcome: ActionReceipt["outcome"],
    startedAt: number,
  ) => Promise<void>;
}

async function finalizeCancellation(
  operation: ActiveProbeOperation,
  cancelStartedAt: number,
  dependencies: CancellationDependencies,
): Promise<FoundationBranch> {
  const { branchRevision, proposalRevision, attempt } = operation;
  if (!branchRevision || !proposalRevision || !attempt) throw new Error("No topology optimization is running");
  const canceledResult: ProbeResult = {
    status: "canceled",
    code: "canceled",
    message: operation.cancellationReason ?? "Topology optimization canceled by the user.",
    elapsedMs: performance.now() - operation.runStartedAt,
  };
  const measurement = await measuredProbe(canceledResult);
  const latest = dependencies.stateRef.current;
  const latestBranch = latest.stagedBranches.find((branch) => branch.branchRevision === branchRevision);
  if (!latestBranch || latestBranch.status !== "running") {
    throw new Error("The running probe branch changed during cancellation");
  }
  const canceled = freezeValue({
    ...latestBranch,
    status: "canceled" as const,
    result: canceledResult,
    measurement,
  });
  dependencies.commit({
    ...latest,
    operationStatus: "canceling",
    stagedBranches: latest.stagedBranches.map((branch) =>
      branch.branchRevision === branchRevision ? canceled : branch),
  });
  const identity = { proposalRevision, attempt };
  try {
    await dependencies.addReceipt(
      "generate_topology_candidate",
      { ...operation.input, ...identity },
      branchRevision,
      { status: "canceled", reason: canceledResult.message },
      operation.runStartedAt,
    );
    await dependencies.addReceipt(
      "cancel_topology_optimization",
      { branchRevision, parentRevision: operation.input.parentRevision, ...identity },
      branchRevision,
      { status: "canceled", reason: canceledResult.message },
      cancelStartedAt,
    );
  } finally {
    operation.detachExternalAbort?.();
    if (dependencies.operationRef.current === operation) {
      dependencies.operationRef.current = null;
      const current = dependencies.stateRef.current;
      dependencies.commit({ ...current, operationStatus: "idle" });
    }
  }
  return dependencies.stateRef.current.stagedBranches.find((branch) =>
    branch.branchRevision === branchRevision) ?? canceled;
}

export function cancelActiveProbe(
  operation: ActiveProbeOperation,
  dependencies: CancellationDependencies,
): Promise<FoundationBranch> {
  if (operation.cancellation) return operation.cancellation;
  const cancelStartedAt = performance.now();
  operation.cancellation = Promise.resolve().then(() =>
    finalizeCancellation(operation, cancelStartedAt, dependencies));
  operation.controller.abort();
  return operation.cancellation;
}

export function abandonedProbe(
  operation: ActiveProbeOperation,
  proposalRevision: string,
  branchRevision: string,
  attempt: number,
): FoundationBranch {
  return freezeValue({
    ...operation.input, proposalRevision, branchRevision, attempt,
    stale: false, status: "canceled" as const,
  });
}
