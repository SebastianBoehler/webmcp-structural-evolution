import { useEffect, useMemo, useRef, useState } from "react";
import type { JsonValue } from "../domain/canonical-json";
import { defineActionReceipt, type ActionReceipt } from "../domain/receipts";
import { revisionId } from "../domain/revisions";
import { runComputeProbe, type ProbeResult } from "../gpu/compute-probe";
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
import { buildProbeInput, measuredProbe, storeProbeResult } from "./project-probe";
import type { ExperimentRailApi, ProjectStateOptions } from "./project-state-types";
import {
  createInitialProjectState,
  freezeValue,
  publishProjectState,
} from "./project-state-copy";

export type { ExperimentRailApi, ProjectStateOptions } from "./project-state-types";

export function useProjectState(options: ProjectStateOptions): {
  readonly state: FoundationProjectState;
  readonly services: FoundationServices;
  readonly experimentRail: ExperimentRailApi;
} {
  const stateRef = useRef<FoundationProjectState | null>(null);
  if (!stateRef.current) stateRef.current = createInitialProjectState(options);
  const [state, setState] = useState(stateRef.current);
  const computeRef = useRef(options.compute ?? runComputeProbe);
  computeRef.current = options.compute ?? runComputeProbe;
  const sequenceRef = useRef(0);
  const operationRef = useRef<symbol | null>(null);
  const interventionGenerationRef = useRef(0);
  const verifiedOutputsRef = useRef(new Map<string, Float32Array>());

  const commit = (next: FoundationProjectState) => {
    const frozen = publishProjectState(next, verifiedOutputsRef.current);
    stateRef.current = frozen;
    setState(frozen);
    return frozen;
  };

  const capabilityKey = JSON.stringify(options.capability);
  useEffect(() => {
    const current = stateRef.current!;
    if (JSON.stringify(current.capability) === capabilityKey) return;
    commit({ ...current, capability: options.capability });
  }, [capabilityKey]);

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
    async runProbe(input) {
      const startedAt = performance.now();
      const parsed = RunFoundationProbeInputSchema.parse(input);
      const current = stateRef.current!;
      const reject = async (error: string, affectedRevision = stateRef.current!.contextRevision): Promise<never> => {
        await addReceipt("run_foundation_probe", parsed, affectedRevision, {
          status: "failed", error,
        }, startedAt);
        throw new Error(error);
      };
      if (current.capability.status !== "available") return reject("WebGPU capability is not available");
      if (operationRef.current || current.operationStatus !== "idle") {
        return reject("A foundation probe is already running");
      }
      if (parsed.parentRevision !== current.contextRevision) return reject("Parent revision is not the exact current context");
      const operation = Symbol("foundation-probe");
      operationRef.current = operation;
      commit({ ...current, operationStatus: "running" });
      const release = () => {
        if (operationRef.current !== operation) return;
        operationRef.current = null;
        const latest = stateRef.current!;
        if (latest.operationStatus !== "idle") commit({ ...latest, operationStatus: "idle" });
      };
      let branchRevision: string;
      try {
        branchRevision = await revisionId({ kind: "foundation-probe-branch", ...parsed });
      } catch (error) {
        release();
        return reject(error instanceof Error ? error.message : String(error));
      }
      let latest = stateRef.current!;
      if (latest.contextRevision !== parsed.parentRevision) {
        release();
        return reject("Parent revision changed before the probe branch was staged");
      }
      if (latest.stagedBranches.some((branch) => branch.branchRevision === branchRevision)) {
        release();
        return reject("This exact foundation probe branch is already staged", branchRevision);
      }
      const staged: FoundationBranch = freezeValue({
        ...parsed, branchRevision, stale: false, status: "running",
      });
      commit({ ...latest, operationStatus: "running", stagedBranches: [...latest.stagedBranches, staged] });
      let result: ProbeResult;
      try {
        result = await computeRef.current(buildProbeInput(parsed.variant));
      } catch (error) {
        result = {
          status: "failed",
          code: "device-error",
          message: error instanceof Error ? error.message : String(error),
          elapsedMs: performance.now() - startedAt,
        };
      }
      const storedResult = storeProbeResult(result);
      const measured = await measuredProbe(storedResult);
      latest = stateRef.current!;
      const latestBranch = latest.stagedBranches.find((branch) =>
        branch.branchRevision === branchRevision);
      if (!latestBranch) {
        release();
        return reject("The staged foundation probe branch is no longer available", branchRevision);
      }
      const finished: FoundationBranch = freezeValue({
        ...latestBranch,
        stale: latestBranch.stale || latest.contextRevision !== parsed.parentRevision,
        status: storedResult.status,
        measurement: measured,
        result: storedResult,
      });
      operationRef.current = null;
      commit({
        ...latest,
        operationStatus: "idle",
        stagedBranches: latest.stagedBranches.map((branch) =>
          branch.branchRevision === branchRevision ? finished : branch),
      });
      const outcome: ActionReceipt["outcome"] = storedResult.status === "verified"
        ? { status: "succeeded", result: { branchRevision, measurement: measured as unknown as JsonValue } }
        : { status: "failed", error: measured.message ?? `${storedResult.status} probe result` };
      await addReceipt("run_foundation_probe", parsed, branchRevision, outcome, startedAt);
      return stateRef.current!.stagedBranches.find((branch) =>
        branch.branchRevision === branchRevision) ?? finished;
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
        await addReceipt("compare_foundation_probes", parsed, current.contextRevision, {
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
        leftDigest: left.measurement.resultDigest,
        rightDigest: right.measurement.resultDigest,
        stale: false,
        nextActions: ["inspect_design_context"],
      };
      await addReceipt("compare_foundation_probes", parsed, current.contextRevision, {
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

  const experimentRail = useMemo<ExperimentRailApi>(() => ({
    async intervene(input) {
      const startedAt = performance.now();
      const generation = ++interventionGenerationRef.current;
      let contextRevision: string;
      while (true) {
        const base = stateRef.current!;
        contextRevision = await revisionId({
          acceptedBranchRevision: base.acceptedBranchRevision,
          selection: input.selection,
          locks: [...input.locks],
        });
        const latest = stateRef.current!;
        if (generation !== interventionGenerationRef.current) {
          const error = "Human intervention was superseded by a newer intervention";
          await addReceipt("human_intervention", input as unknown as JsonValue, latest.contextRevision, {
            status: "failed", error,
          }, startedAt);
          throw new Error(error);
        }
        if (latest.acceptedBranchRevision !== base.acceptedBranchRevision) continue;
        commit({
          ...latest,
          contextRevision,
          selection: { ...input.selection },
          locks: [...input.locks],
          stagedBranches: latest.stagedBranches.map((branch) => ({ ...branch, stale: true })),
        });
        break;
      }
      await addReceipt("human_intervention", input as unknown as JsonValue, contextRevision, {
        status: "succeeded", result: { contextRevision },
      }, startedAt);
    },
    async promoteBranch(branchRevision) {
      const startedAt = performance.now();
      const current = stateRef.current!;
      const branch = current.stagedBranches.find((item) => item.branchRevision === branchRevision);
      if (!branch || branch.status !== "verified" || branch.stale) {
        await addReceipt("promote_branch", { branchRevision }, branchRevision, {
          status: "failed", error: "Only an exact verified non-stale branch can be promoted",
        }, startedAt);
        throw new Error("Only an exact verified non-stale branch can be promoted");
      }
      const expectedContextRevision = current.contextRevision;
      const contextRevision = await revisionId({
        acceptedBranchRevision: branchRevision,
        selection: current.selection,
        locks: current.locks,
      });
      const latest = stateRef.current!;
      const latestBranch = latest.stagedBranches.find((item) => item.branchRevision === branchRevision);
      if (
        latest.contextRevision !== expectedContextRevision ||
        !latestBranch ||
        latestBranch.status !== "verified" ||
        latestBranch.stale
      ) {
        const error = "Project context changed before branch promotion completed";
        await addReceipt("promote_branch", { branchRevision }, branchRevision, {
          status: "failed", error,
        }, startedAt);
        throw new Error(error);
      }
      commit({ ...latest, acceptedBranchRevision: branchRevision, contextRevision });
      await addReceipt("promote_branch", { branchRevision }, branchRevision, {
        status: "succeeded", result: { acceptedBranchRevision: branchRevision },
      }, startedAt);
    },
  }), []);

  return { state, services, experimentRail };
}
