import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import type { ContextSelection } from "../domain/foundation-context";
import type { FoundationServices } from "../webmcp/executors";
import type { FoundationProjectState, SemanticSelection } from "../webmcp/schemas";
import type { ExactCadGateResult } from "../cad/kernel/browser-cad-gate";
import type { ExactCadProjectGateState } from "./use-exact-cad-project-gate";
import type { EngineeringWorkspaceService } from "../workspace/engineering-workspace-service";
import type { WorkspaceInspection } from "../workspace/workspace-inspection";
import type { LayoutAuthority } from "../assembly/layout-validation";

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
  readonly exactCadGate?: (signal: AbortSignal) => Promise<ExactCadGateResult>;
  readonly workspace?: EngineeringWorkspaceService;
  readonly layoutAuthority?: LayoutAuthority;
}

export interface ExperimentRailApi {
  intervene(input: { readonly selection: ContextSelection; readonly locks: readonly string[] }): Promise<void>;
  promoteBranch(branchRevision: string): Promise<void>;
}

export interface ProjectStateApi {
  readonly state: FoundationProjectState;
  readonly services: FoundationServices;
  readonly experimentRail: ExperimentRailApi;
  readonly exactCadGate: ExactCadProjectGateState;
  readonly workspaceInspection: WorkspaceInspection | null;
}
