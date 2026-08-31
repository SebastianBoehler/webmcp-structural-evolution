import type { EngineeringJobKind } from "../cad/engineering-job-contract";
import type { CapabilityDecision, EngineeringSolveRequest, SolverAdapter } from "./solver-adapter";

export type SolverRegistryErrorCode =
  | "duplicate-job-kind"
  | "unregistered-job-kind"
  | "kind-mismatch"
  | "unsupported-capability";

export class SolverRegistryError extends Error {
  readonly code: SolverRegistryErrorCode;
  readonly kind: EngineeringJobKind;
  readonly decision?: CapabilityDecision;

  constructor(
    code: SolverRegistryErrorCode,
    kind: EngineeringJobKind,
    message: string,
    decision?: CapabilityDecision,
  ) {
    super(message);
    this.name = "SolverRegistryError";
    this.code = code;
    this.kind = kind;
    this.decision = decision;
  }
}

export interface SolverRegistry {
  register<Input, Output>(adapter: SolverAdapter<Input, Output>): void;
  resolve(
    kind: EngineeringJobKind,
    request: EngineeringSolveRequest<unknown>,
  ): SolverAdapter<unknown, unknown>;
}

export function createSolverRegistry(): SolverRegistry {
  const adapters = new Map<EngineeringJobKind, SolverAdapter<unknown, unknown>>();
  return {
    register<Input, Output>(adapter: SolverAdapter<Input, Output>): void {
      const { kind } = adapter.capability;
      if (adapters.has(kind)) {
        throw new SolverRegistryError("duplicate-job-kind", kind, `Solver adapter already registered for: ${kind}`);
      }
      adapters.set(kind, adapter as SolverAdapter<unknown, unknown>);
    },
    resolve(kind, request) {
      if (request.kind !== kind) {
        throw new SolverRegistryError("kind-mismatch", kind, "Requested job kind does not match the solve request");
      }
      const adapter = adapters.get(kind);
      if (!adapter) {
        throw new SolverRegistryError("unregistered-job-kind", kind, `No solver adapter is registered for: ${kind}`);
      }
      const decision = adapter.supports(request);
      if (!decision.supported) {
        throw new SolverRegistryError(
          "unsupported-capability",
          kind,
          `Unsupported ${kind} capability: ${decision.error.limit.kind} (${decision.error.limit.rule})`,
          decision,
        );
      }
      return adapter;
    },
  };
}
