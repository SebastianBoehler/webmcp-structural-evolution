import type {
  EngineeringJobError,
  EngineeringJobEvent,
  EngineeringJobKind,
  EngineeringSolveRequest as BaseEngineeringSolveRequest,
} from "../cad/engineering-job-contract";

export type EngineeringSolveRequest<Input> = BaseEngineeringSolveRequest<Input>;

export interface SolverCapability {
  readonly kind: EngineeringJobKind;
}

export type UnsupportedCapabilityDecision = Readonly<{
  supported: false;
  error: Extract<EngineeringJobError, { code: "unsupported-capability" }>;
}>;
export type CapabilityDecision = Readonly<{ supported: true }> | UnsupportedCapabilityDecision;

export interface SolverAdapter<Input, Output> {
  readonly capability: SolverCapability;
  supports(request: EngineeringSolveRequest<Input>): CapabilityDecision;
  run(
    request: EngineeringSolveRequest<Input>,
    signal: AbortSignal,
    emit: (event: EngineeringJobEvent) => void,
  ): Promise<Output>;
}
