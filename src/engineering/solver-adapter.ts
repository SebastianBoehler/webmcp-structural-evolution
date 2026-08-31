import type {
  EngineeringJobError,
  EngineeringJobKind,
  EngineeringSolveRequest as BaseEngineeringSolveRequest,
  EngineeringTruthLevel,
} from "../cad/engineering-job-contract";
import type { ArtifactRecord } from "../cad/artifact-contract";
import type { ArtifactPayload } from "./artifact-store";

export type EngineeringSolveRequest<Input> = BaseEngineeringSolveRequest<Input>;

export interface SolverCapability {
  readonly kind: EngineeringJobKind;
}

export type UnsupportedCapabilityDecision = Readonly<{
  supported: false;
  error: Extract<EngineeringJobError, { code: "unsupported-capability" }>;
}>;
export type CapabilityDecision = Readonly<{ supported: true }> | UnsupportedCapabilityDecision;

export type SolverProgressEvent = Readonly<{
  progress: number;
}>;

export type SolverGeneratedArtifact = Readonly<{
  record: ArtifactRecord;
  payload: ArtifactPayload;
}>;

export type SolverRunResult<Output> = Readonly<{
  output: Output;
  truthLevel: EngineeringTruthLevel;
  artifacts: readonly [SolverGeneratedArtifact, ...SolverGeneratedArtifact[]];
}>;

export interface SolverAdapter<Input, Output> {
  readonly capability: SolverCapability;
  supports(request: EngineeringSolveRequest<Input>): CapabilityDecision;
  run(
    request: EngineeringSolveRequest<Input>,
    signal: AbortSignal,
    emit: (event: SolverProgressEvent) => void,
  ): Promise<SolverRunResult<Output>>;
}
