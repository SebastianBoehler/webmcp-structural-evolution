import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import type { ContextSelection } from "../domain/foundation-context";
import type { FoundationServices } from "../webmcp/executors";
import type { FoundationProjectState, SemanticSelection } from "../webmcp/schemas";

type ProbeRunner = (input: ProbeInput, signal?: AbortSignal) => Promise<ProbeResult>;

export interface ProjectStateOptions {
  readonly contextRevision: string;
  readonly context: FoundationProjectState["context"];
  readonly acceptedBranchRevision: string;
  readonly selection: SemanticSelection;
  readonly locks: readonly string[];
  readonly capability: FoundationProjectState["capability"];
  readonly compute?: ProbeRunner;
  readonly buildProbeInput?: (variant: import("../webmcp/schemas").ProbeVariant) => ProbeInput;
}

export interface ExperimentRailApi {
  intervene(input: { readonly selection: ContextSelection; readonly locks: readonly string[] }): Promise<void>;
  promoteBranch(branchRevision: string): Promise<void>;
}

export interface ProjectStateApi {
  readonly state: FoundationProjectState;
  readonly services: FoundationServices;
  readonly experimentRail: ExperimentRailApi;
}
