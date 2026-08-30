export type CadRebuildFailureCode =
  | "feature-failed"
  | "invalid-solid"
  | "reference-requires-repair";

export class CadRebuildError extends Error {
  constructor(readonly code: CadRebuildFailureCode, message: string) {
    super(message);
    this.name = "CadRebuildError";
  }
}
