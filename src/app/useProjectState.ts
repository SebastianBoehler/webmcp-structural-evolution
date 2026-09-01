import { useMemo, useRef, useState } from "react";
import type { JsonValue } from "../domain/canonical-json";
import { defineActionReceipt, type ActionReceipt } from "../domain/receipts";
import { revisionId } from "../domain/revisions";
import type { ProbeResult } from "../gpu/compute-probe";
import { runTopologyProbe } from "../optimization/topology-probe";
import type { FoundationServices } from "../webmcp/executors";
import {
  CompareFoundationProbesInputSchema,
  RunFoundationProbeInputSchema,
  type CompareFoundationProbesInput,
  type FoundationBranch,
  type FoundationProjectState,
  type ProbeComparisonFacts,
  type RunFoundationProbeInput,
} from "../webmcp/schemas";
import { toolFactsFit } from "../webmcp/tool-output";
import { hasComparableBranches } from "../webmcp/comparability";
import { inspectProjectFacts } from "./project-inspection";
import { createExperimentRail } from "./project-experiment-rail";
import { buildProbeInput, measuredProbe, storeProbeResult } from "./project-probe";
import { abandonedProbe, cancelActiveProbe, type ActiveProbeOperation } from "./project-probe-cancellation";
import type { ExperimentRailApi, ProjectStateApi, ProjectStateOptions } from "./project-state-types";
import { createInitialProjectState, freezeValue, publishProjectState } from "./project-state-copy";
import { useExactCadProjectGate } from "./use-exact-cad-project-gate";
import { useProjectOptionSync } from "./use-project-option-sync";
import { useActiveProbeUnmount } from "./use-active-probe-unmount";
import { useWorkspaceInspection } from "./use-workspace-inspection";
export type { ExperimentRailApi, ProjectStateOptions } from "./project-state-types";

export function useProjectState(options: ProjectStateOptions): ProjectStateApi {
  const stateRef = useRef<FoundationProjectState | null>(null);
  if (!stateRef.current) stateRef.current = createInitialProjectState(options);
  const [state, setState] = useState(stateRef.current);
  const computeRef = useRef(options.compute ?? runTopologyProbe);
  computeRef.current = options.compute ?? runTopologyProbe;
  const inputBuilderRef = useRef(options.buildProbeInput ?? buildProbeInput);
  inputBuilderRef.current = options.buildProbeInput ?? buildProbeInput;
  const sequenceRef = useRef(0);
  const operationRef = useRef<ActiveProbeOperation | null>(null);
  const interventionGenerationRef = useRef(0);
  const verifiedOutputsRef = useRef(new Map<string, Float32Array>());
  const exactCadGate = useExactCadProjectGate(options.exactCadGate);
  const workspaceInspection = useWorkspaceInspection(options.workspace);

  const commit = (next: FoundationProjectState) => {
    const frozen = publishProjectState(next, verifiedOutputsRef.current);
    stateRef.current = frozen;
    setState(frozen);
    return frozen;
  };

  useProjectOptionSync(options, workspaceInspection?.headRevision ?? options.contextRevision, stateRef, commit);

  const addReceipt = async (
    action: string,
    validatedInputs: JsonValue,
    affectedRevision: string,
    outcome: ActionReceipt["outcome"],
    startedAt: number,
  ) => {
    const createdAt = new Date().toISOString();
    const id = await revisionId({ action, affectedRevision, createdAt, sequence: sequenceRef.current++ });
    const receipt = defineActionReceipt({
      id,
      action,
      validatedInputs,
      affectedRevision,
      outcome,
      duration: { value: Math.max(0, performance.now() - startedAt), unit: "ms" },
      createdAt,
    });
    const current = stateRef.current!;
    commit({ ...current, receipts: [...current.receipts, receipt] });
  };

  const cancellationDependencies = () => ({
    stateRef: stateRef as { current: FoundationProjectState },
    operationRef,
    commit,
    addReceipt,
  });

  useActiveProbeUnmount(operationRef, (operation) =>
    cancelActiveProbe(operation, cancellationDependencies()));

  const services = useMemo<FoundationServices>(() => ({
    async inspectContext(input) {
      const startedAt = performance.now();
      const facts = inspectProjectFacts(stateRef.current!);
      if (!toolFactsFit(facts)) {
        const error = "Inspect output exceeded the 1500 character safety limit";
        await addReceipt("inspect_design_context", input, facts.contextRevision, {
          status: "failed", error,
        }, startedAt);
        throw new Error(error);
      }
      await addReceipt("inspect_design_context", input, facts.contextRevision, {
        status: "succeeded",
        result: { contextRevision: facts.contextRevision },
      }, startedAt);
      return facts;
    },
    async runProbe(input, invocationSignal) {
      const startedAt = performance.now();
      const parsed = RunFoundationProbeInputSchema.parse(input);
      const current = stateRef.current!;
      const reject = async (error: string, affectedRevision = stateRef.current!.contextRevision): Promise<never> => {
        await addReceipt("generate_topology_candidate", parsed, affectedRevision, {
          status: "failed", error,
        }, startedAt);
        throw new Error(error);
      };
      if (current.capability.status !== "available") return reject("WebGPU capability is not available");
      if (operationRef.current || current.operationStatus !== "idle") {
        return reject("A topology optimization is already running");
      }
      if (parsed.parentRevision !== current.contextRevision) return reject("Parent revision is not the exact current context");
      const sameIntent = current.stagedBranches.filter((branch) =>
        branch.parentRevision === parsed.parentRevision &&
        branch.variant === parsed.variant &&
        branch.hypothesis === parsed.hypothesis &&
        branch.prediction === parsed.prediction);
      if (sameIntent.some((branch) => branch.status === "running" || branch.status === "verified")) {
        return reject("This exact topology candidate is already staged");
      }
      const operation: ActiveProbeOperation = {
        controller: new AbortController(),
        input: parsed,
        runStartedAt: startedAt,
      };
      operationRef.current = operation;
      const release = () => {
        if (operationRef.current !== operation) return;
        operation.detachExternalAbort?.();
        operationRef.current = null;
        const latest = stateRef.current!;
        if (latest.operationStatus !== "idle") commit({ ...latest, operationStatus: "idle" });
      };
      if (invocationSignal) {
        const abortFromInvocation = () => {
          operation.cancellationReason = "Topology optimization canceled by the invoking client.";
          operation.controller.abort();
          if (operation.branchRevision) {
            void cancelActiveProbe(operation, cancellationDependencies()).catch(() => undefined);
          }
        };
        invocationSignal.addEventListener("abort", abortFromInvocation, { once: true });
        operation.detachExternalAbort = () =>
          invocationSignal.removeEventListener("abort", abortFromInvocation);
        if (invocationSignal.aborted) abortFromInvocation();
      }
      const attempt = sameIntent.length + 1;
      let proposalRevision: string;
      let branchRevision: string;
      try {
        proposalRevision = await revisionId({ kind: "foundation-probe-proposal", ...parsed });
        branchRevision = await revisionId({ kind: "foundation-probe-attempt", proposalRevision, attempt });
      } catch (error) {
        release();
        return reject(error instanceof Error ? error.message : String(error));
      }
      if (operation.abandoned) return abandonedProbe(operation, proposalRevision, branchRevision, attempt);
      let latest = stateRef.current!;
      if (latest.contextRevision !== parsed.parentRevision) {
        release();
        return reject("Parent revision changed before the probe branch was staged");
      }
      if (latest.stagedBranches.some((branch) => branch.branchRevision === branchRevision)) {
        release();
        return reject("This exact topology candidate is already staged", branchRevision);
      }
      const staged: FoundationBranch = freezeValue({
        ...parsed, proposalRevision, branchRevision, attempt, stale: false, status: "running",
      });
      operation.branchRevision = branchRevision;
      operation.proposalRevision = proposalRevision;
      operation.attempt = attempt;
      commit({ ...latest, operationStatus: "running", stagedBranches: [...latest.stagedBranches, staged] });
      if (invocationSignal?.aborted) {
        return cancelActiveProbe(operation, cancellationDependencies());
      }
      let result: ProbeResult;
      try {
        result = await computeRef.current(inputBuilderRef.current(parsed.variant), operation.controller.signal);
      } catch (error) {
        result = {
          status: "failed",
          code: "device-error",
          message: error instanceof Error ? error.message : String(error),
          elapsedMs: performance.now() - startedAt,
        };
      }
      if (operation.cancellation) return operation.cancellation;
      const storedResult = storeProbeResult(result);
      const measured = await measuredProbe(storedResult);
      if (operation.cancellation) return operation.cancellation;
      latest = stateRef.current!;
      if (operationRef.current !== operation) {
        return latest.stagedBranches.find((branch) => branch.branchRevision === branchRevision) ?? staged;
      }
      const latestBranch = latest.stagedBranches.find((branch) =>
        branch.branchRevision === branchRevision);
      if (!latestBranch) {
        release();
        return reject("The staged topology candidate is no longer available", branchRevision);
      }
      const finished: FoundationBranch = freezeValue({
        ...latestBranch,
        stale: latestBranch.stale || latest.contextRevision !== parsed.parentRevision,
        status: storedResult.status,
        measurement: measured,
        result: storedResult,
      });
      operationRef.current = null;
      operation.detachExternalAbort?.();
      commit({
        ...latest,
        operationStatus: "idle",
        stagedBranches: latest.stagedBranches.map((branch) =>
          branch.branchRevision === branchRevision ? finished : branch),
      });
      const outcome: ActionReceipt["outcome"] = storedResult.status === "verified"
        ? {
            status: "succeeded",
            result: { proposalRevision, branchRevision, attempt, measurement: measured as unknown as JsonValue },
          }
        : storedResult.status === "canceled"
          ? { status: "canceled", reason: measured.message ?? "Topology optimization canceled" }
          : { status: "failed", error: measured.message ?? `${storedResult.status} probe result` };
      await addReceipt("generate_topology_candidate", {
        ...parsed, proposalRevision, attempt,
      }, branchRevision, outcome, startedAt);
      return stateRef.current!.stagedBranches.find((branch) =>
        branch.branchRevision === branchRevision) ?? finished;
    },
    async cancelProbe() {
      const operation = operationRef.current;
      if (!operation?.branchRevision) throw new Error("No topology optimization is running");
      return cancelActiveProbe(operation, cancellationDependencies());
    },
    async compareProbes(input) {
      const startedAt = performance.now();
      const parsed = CompareFoundationProbesInputSchema.parse(input);
      const current = stateRef.current!;
      const find = (revision: string) => current.stagedBranches.find((branch) => branch.branchRevision === revision);
      const left = find(parsed.leftRevision);
      const right = find(parsed.rightRevision);
      const valid = (branch: FoundationBranch | undefined): branch is FoundationBranch & { measurement: NonNullable<FoundationBranch["measurement"]> } =>
        branch?.status === "verified" && !branch.stale && branch.measurement !== undefined;
      if (!valid(left) || !valid(right) || left.parentRevision !== right.parentRevision) {
        await addReceipt("compare_topology_candidates", parsed, current.contextRevision, {
          status: "failed", error: "Branches must be verified, non-stale, and share an exact parent",
        }, startedAt);
        throw new Error("Branches must be verified, non-stale, and share an exact parent");
      }
      const facts: ProbeComparisonFacts = {
        parentRevision: left.parentRevision,
        leftRevision: left.branchRevision,
        rightRevision: right.branchRevision,
        leftStatus: "verified",
        rightStatus: "verified",
        timingDeltaMs: right.measurement.elapsedMs - left.measurement.elapsedMs,
        relativeL2Delta: (right.measurement.relativeL2 ?? 0) - (left.measurement.relativeL2 ?? 0),
        ...(left.measurement.topology && right.measurement.topology ? {
          complianceDelta: right.measurement.topology.finalCompliance - left.measurement.topology.finalCompliance,
          materialFractionDelta: right.measurement.topology.materialFraction - left.measurement.topology.materialFraction,
        } : {}),
        leftDigest: left.measurement.resultDigest,
        rightDigest: right.measurement.resultDigest,
        stale: false,
        nextActions: ["inspect_design_context"],
      };
      await addReceipt("compare_topology_candidates", parsed, current.contextRevision, {
        status: "succeeded", result: facts as unknown as JsonValue,
      }, startedAt);
      return facts;
    },
    canCompare() {
      return hasComparableBranches(stateRef.current!.stagedBranches);
    },
    async recordRejectedCall(action, affectedRevision, error) {
      const current = stateRef.current!;
      await addReceipt(action, { rejected: true }, affectedRevision ?? current.contextRevision, {
        status: "failed", error,
      }, performance.now());
    },
  }), []);

  const experimentRail = useMemo<ExperimentRailApi>(() => createExperimentRail({
    stateRef: stateRef as { current: FoundationProjectState },
    generationRef: interventionGenerationRef,
    commit,
    addReceipt,
  }), []);
  return { state, services, experimentRail, exactCadGate, workspaceInspection };
}
