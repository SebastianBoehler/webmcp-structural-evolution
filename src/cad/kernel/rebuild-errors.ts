export type CadRebuildFailureCode =
  | "feature-failed"
  | "invalid-solid"
  | "reference-requires-repair"
  | "resource-limit"
  | "sketch-constraint-unsatisfied"
  | "sketch-under-constrained"
  | "sketch-over-constrained";

export class CadRebuildError extends Error {
  constructor(readonly code: CadRebuildFailureCode, message: string) {
    super(message);
    this.name = "CadRebuildError";
  }
}
