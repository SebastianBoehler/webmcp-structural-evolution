import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import type { FoundationProjectState, SemanticSelection } from "../webmcp/schemas";

type ProbeRunner = (input: ProbeInput, signal?: AbortSignal) => Promise<ProbeResult>;

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
