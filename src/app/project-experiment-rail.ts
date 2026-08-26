import type { JsonValue } from "../domain/canonical-json";
import type { ActionReceipt } from "../domain/receipts";
import { revisionId } from "../domain/revisions";
import type { FoundationProjectState } from "../webmcp/schemas";
import type { ExperimentRailApi } from "./project-state-types";
import { canonicalLockIds } from "./project-state-copy";

interface MutableRef<T> {
  current: T;
}

interface ExperimentRailDependencies {
  readonly stateRef: MutableRef<FoundationProjectState>;
  readonly generationRef: MutableRef<number>;
  readonly commit: (next: FoundationProjectState) => FoundationProjectState;
  readonly addReceipt: (
    action: string,
    validatedInputs: JsonValue,
    affectedRevision: string,
    outcome: ActionReceipt["outcome"],
    startedAt: number,
  ) => Promise<void>;
}

export function createExperimentRail({
  stateRef,
  generationRef,
  commit,
  addReceipt,
}: ExperimentRailDependencies): ExperimentRailApi {
  return {
    async intervene(input) {
      const startedAt = performance.now();
      const generation = ++generationRef.current;
      const locks = canonicalLockIds(input.locks);
      const normalizedInput = { selection: input.selection, locks };
      let contextRevision: string;
      while (true) {
        const base = stateRef.current;
        if (
          base.selection.id === input.selection.id &&
          base.selection.label === input.selection.label &&
          base.locks.length === locks.length &&
          base.locks.every((lock, index) => lock === locks[index])
        ) {
          await addReceipt("human_intervention", normalizedInput as unknown as JsonValue, base.contextRevision, {
            status: "succeeded", result: { contextRevision: base.contextRevision, unchanged: true },
          }, startedAt);
          return;
        }
        contextRevision = await revisionId({
          acceptedBranchRevision: base.acceptedBranchRevision,
          selection: input.selection,
          locks,
        });
        const latest = stateRef.current;
        if (generation !== generationRef.current) {
          const error = "Human intervention was superseded by a newer intervention";
          await addReceipt("human_intervention", normalizedInput as unknown as JsonValue, latest.contextRevision, {
            status: "failed", error,
          }, startedAt);
          throw new Error(error);
        }
        if (latest.acceptedBranchRevision !== base.acceptedBranchRevision) continue;
        commit({
          ...latest,
          contextRevision,
          selection: { ...input.selection },
          locks,
          stagedBranches: latest.stagedBranches.map((branch) => ({ ...branch, stale: true })),
        });
        break;
      }
      await addReceipt("human_intervention", normalizedInput as unknown as JsonValue, contextRevision, {
        status: "succeeded", result: { contextRevision },
      }, startedAt);
    },

    async promoteBranch(branchRevision) {
      const startedAt = performance.now();
      const current = stateRef.current;
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
      const latest = stateRef.current;
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
  };
}
