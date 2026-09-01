import type { ArtifactRecord } from "../cad/artifact-contract";
import type { DesignTransaction } from "../cad/command-schema";
import type { DesignSession, DesignSessionClock } from "../cad/design-session";
import type { CadKernelAdapter } from "../cad/runtime-contracts";
import type { ActionReceipt } from "../domain/receipts";
import type { ArtifactStore } from "../engineering/artifact-store";
import type { JobLedgerEntry } from "../engineering/job-ledger";
import type { SolverRegistry } from "../engineering/solver-registry";
import type { DryRunRequest, RebuildRequest } from "./workspace-cad";
import type { WorkspaceEvent } from "./workspace-events";
import type {
  ExportApproval, ResultComparison, TransactionPreview, WorkspaceInspection,
} from "./workspace-inspection";
import type { StudyRequestPlanners } from "./workspace-study-plan";

export type LaunchStudyRequest = Readonly<{ studyId: string; expectedRevision: string }>;

export interface EngineeringWorkspaceOptions {
  readonly session: DesignSession;
  readonly store: ArtifactStore;
  readonly registry: SolverRegistry;
  readonly createCadAdapter: () => CadKernelAdapter;
  readonly createEphemeralStore?: () => ArtifactStore;
  readonly planners: StudyRequestPlanners;
  readonly clock: DesignSessionClock;
  readonly verifyExportApproval?: (
    approval: ExportApproval, artifact: ArtifactRecord, headRevision: string,
  ) => Promise<boolean>;
}

export interface EngineeringWorkspaceService {
  inspect(): WorkspaceInspection;
  dryRun(request: DryRunRequest, signal?: AbortSignal): Promise<TransactionPreview>;
  apply(transaction: DesignTransaction): Promise<ActionReceipt>;
  rebuild(request: RebuildRequest, signal?: AbortSignal): Promise<ActionReceipt>;
  launchStudy(request: LaunchStudyRequest): Promise<{ readonly jobId: string }>;
  cancelJob(jobId: string): Promise<void>;
  inspectJob(jobId: string): JobLedgerEntry;
  compareResults(leftArtifactId: string, rightArtifactId: string): Promise<ResultComparison>;
  exportArtifact(artifactId: string, approval: ExportApproval): Promise<Blob>;
  subscribe(listener: (event: WorkspaceEvent) => void): () => void;
  dispose(): void;
}
