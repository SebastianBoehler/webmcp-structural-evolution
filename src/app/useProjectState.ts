import { useMemo, useRef, useState } from "react";

import type { JsonValue } from "../domain/canonical-json";
import { defineActionReceipt, type ActionReceipt } from "../domain/receipts";
import { revisionId } from "../domain/revisions";
import { runComputeProbe, type ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import type { FoundationServices } from "../webmcp/executors";
import {
  CompareFoundationProbesInputSchema,
  RunFoundationProbeInputSchema,
  type CompareFoundationProbesInput,
  type FoundationBranch,
  type FoundationProjectState,
  type InspectContextFacts,
  type ProbeComparisonFacts,
  type RunFoundationProbeInput,
  type SemanticSelection,
} from "../webmcp/schemas";
import { buildProbeInput, measuredProbe, storeProbeResult } from "./project-probe";

type ProbeRunner = (input: ProbeInput) => Promise<ProbeResult>;

export interface ProjectStateOptions {
  readonly contextRevision: string;
  readonly acceptedBranchRevision: string;
  readonly selection: SemanticSelection;
  readonly locks: readonly string[];
  readonly capability: FoundationProjectState["capability"];
  readonly compute?: ProbeRunner;
}

export interface ExperimentRailApi {
  intervene(input: { readonly selection: SemanticSelection; readonly locks: readonly string[] }): Promise<void>;
  promoteBranch(branchRevision: string): Promise<void>;
}

function freezeValue<T>(value: T): T {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) freezeValue(child);
  return Object.freeze(value);
}

function initialState(options: ProjectStateOptions): FoundationProjectState {
  return freezeValue({
    contextRevision: options.contextRevision,
    acceptedBranchRevision: options.acceptedBranchRevision,
    selection: { ...options.selection },
    locks: [...options.locks],
    stagedBranches: [],
    capability: options.capability,
    operationStatus: "idle",
    receipts: [],
  });
}

function inspectFacts(state: FoundationProjectState): InspectContextFacts {
  const comparable = state.stagedBranches.filter((branch) => branch.status === "verified" && !branch.stale);
  return {
    contextRevision: state.contextRevision,
    selection: state.selection,
    locks: state.locks,
    acceptedBranchRevision: state.acceptedBranchRevision,
    stagedBranches: state.stagedBranches.map((branch) => ({
      parentRevision: branch.parentRevision,
      branchRevision: branch.branchRevision,
      hypothesis: branch.hypothesis,
      prediction: branch.prediction,
      status: branch.status,
      stale: branch.stale,
      measurement: branch.measurement,
    })),
    capability: state.capability,
    stale: state.stagedBranches.some((branch) => branch.stale),
    nextActions: [
      ...(state.capability.status === "available" && state.operationStatus === "idle" ? ["run_foundation_probe"] : []),
      ...(comparable.length >= 2 ? ["compare_foundation_probes"] : []),
    ],
  };
}

export function useProjectState(options: ProjectStateOptions): {
  readonly state: FoundationProjectState;
  readonly services: FoundationServices;
  readonly experimentRail: ExperimentRailApi;
} {
  const stateRef = useRef<FoundationProjectState | null>(null);
  if (!stateRef.current) stateRef.current = initialState(options);
  const [state, setState] = useState(stateRef.current);
  const computeRef = useRef(options.compute ?? runComputeProbe);
  computeRef.current = options.compute ?? runComputeProbe;
  const sequenceRef = useRef(0);

  const commit = (next: FoundationProjectState) => {
    const frozen = freezeValue(next);
    stateRef.current = frozen;
    setState(frozen);
    return frozen;
  };

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
      const facts = inspectFacts(stateRef.current!);
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
      const reject = async (error: string): Promise<never> => {
        await addReceipt("run_foundation_probe", parsed, current.contextRevision, {
          status: "failed", error,
        }, startedAt);
        throw new Error(error);
      };
      if (current.capability.status !== "available") return reject("WebGPU capability is not available");
      if (current.operationStatus !== "idle") return reject("A foundation probe is already running");
      if (parsed.parentRevision !== current.contextRevision) return reject("Parent revision is not the exact current context");
      const branchRevision = await revisionId({ kind: "foundation-probe-branch", ...parsed });
      const staged: FoundationBranch = freezeValue({
        ...parsed, branchRevision, stale: false, status: "running",
      });
      commit({ ...current, operationStatus: "running", stagedBranches: [...current.stagedBranches, staged] });
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
      const finished: FoundationBranch = freezeValue({
        ...staged,
        status: storedResult.status,
        measurement: measured,
        result: storedResult,
      });
      const latest = stateRef.current!;
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
      return finished;
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
      const current = stateRef.current!;
      const contextRevision = await revisionId({
        acceptedBranchRevision: current.acceptedBranchRevision,
        selection: input.selection,
        locks: [...input.locks],
      });
      commit({
        ...current,
        contextRevision,
        selection: { ...input.selection },
        locks: [...input.locks],
        stagedBranches: current.stagedBranches.map((branch) => ({ ...branch, stale: true })),
      });
      await addReceipt("human_intervention", input as unknown as JsonValue, contextRevision, {
        status: "succeeded", result: { contextRevision },
      }, startedAt);
    },
    async promoteBranch(branchRevision) {
      const startedAt = performance.now();
      const current = stateRef.current!;
      const branch = current.stagedBranches.find((item) => item.branchRevision === branchRevision);
      if (!branch || branch.status !== "verified" || branch.stale) {
        throw new Error("Only an exact verified non-stale branch can be promoted");
      }
      const contextRevision = await revisionId({
        acceptedBranchRevision: branchRevision,
        selection: current.selection,
        locks: current.locks,
      });
      commit({ ...current, acceptedBranchRevision: branchRevision, contextRevision });
      await addReceipt("promote_branch", { branchRevision }, branchRevision, {
        status: "succeeded", result: { acceptedBranchRevision: branchRevision },
      }, startedAt);
    },
  }), []);

  return { state, services, experimentRail };
}
