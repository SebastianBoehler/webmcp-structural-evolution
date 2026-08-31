import { ArtifactRecordSchema, type ArtifactRecord } from "../cad/artifact-contract";
import {
  EngineeringJobErrorSchema,
  EngineeringTruthLevelSchema,
  type EngineeringJobError,
  type EngineeringSolveRequest,
  type EngineeringTruthLevel,
} from "../cad/engineering-job-contract";
import { ArtifactStoreError, type ArtifactPayload } from "./artifact-store";
import { generatedArtifactDependencyError } from "./generated-artifact-dependencies";
import { SolverRegistryError } from "./solver-registry";
import type { SolverGeneratedArtifact, SolverRunResult } from "./solver-adapter";

export type PreparedSolverRunResult<Output> = Readonly<{
  output: Output;
  truthLevel: EngineeringTruthLevel;
  artifacts: readonly Readonly<{ record: ArtifactRecord; payload: ArtifactPayload }>[];
}>;

class RunnerFailure extends Error {
  readonly error: EngineeringJobError;

  constructor(error: EngineeringJobError) {
    super(error.message);
    this.name = "RunnerFailure";
    this.error = error;
  }
}

export function staleRevisionError(): EngineeringJobError {
  return { code: "stale-revision", message: "Source revision is no longer the current design document" };
}

export function invalidInputError(message: string): EngineeringJobError {
  return { code: "invalid-input", message };
}

function invalidInput(message: string): RunnerFailure {
  return new RunnerFailure(invalidInputError(message));
}

function errorMessage(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error
    ? (error as { message?: unknown }).message
    : undefined;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : "Solver runtime failed without an error message";
}

export function toEngineeringJobError(error: unknown): EngineeringJobError {
  if (error instanceof RunnerFailure) return error.error;
  if (error instanceof SolverRegistryError) {
    if (error.code === "unsupported-capability" && error.decision && !error.decision.supported) {
      return error.decision.error;
    }
    return { code: "invalid-input", message: error.message };
  }
  if (error instanceof ArtifactStoreError) {
    return error.code === "duplicate-artifact-id" || error.code === "commit-failed"
      ? { code: "internal-error", message: error.message }
      : { code: "invalid-input", message: error.message };
  }
  const coded = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const code = coded?.code;
  const message = errorMessage(error);
  if (code === "resource-limit" || code === "device-lost" || code === "diverged"
    || code === "invalid-input" || code === "stale-revision" || code === "internal-error") {
    return { code, message };
  }
  if (code === "unsupported-capability") {
    const typed = EngineeringJobErrorSchema.safeParse({ code, message, limit: coded?.limit });
    if (typed.success) return typed.data;
    return { code: "internal-error", message };
  }
  if (code === "commit-failed" || code === "store-failed") {
    return { code: "internal-error", message };
  }
  const typed = EngineeringJobErrorSchema.safeParse(error);
  if (typed.success) return typed.data;
  return { code: "internal-error", message: errorMessage(error) };
}

function runResultParts(result: unknown): {
  output: unknown;
  truthLevel: EngineeringTruthLevel;
  artifacts: readonly SolverGeneratedArtifact[];
} {
  if (!result || typeof result !== "object") throw invalidInput("Solver adapter returned no result envelope");
  const value = result as Record<string, unknown>;
  const truthLevel = EngineeringTruthLevelSchema.safeParse(value.truthLevel);
  if (!truthLevel.success) throw invalidInput("Solver result must include a valid truth level");
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    throw invalidInput("Solver result must include at least one generated artifact");
  }
  return {
    output: value.output,
    truthLevel: truthLevel.data,
    artifacts: value.artifacts as readonly SolverGeneratedArtifact[],
  };
}

export async function prepareSolverRunResult(
  request: EngineeringSolveRequest<unknown>,
  result: SolverRunResult<unknown>,
): Promise<PreparedSolverRunResult<unknown>> {
  const parts = runResultParts(result);
  const inputs: ArtifactRecord[] = [];
  for (const input of request.inputArtifacts) {
    try {
      inputs.push(await ArtifactRecordSchema.parseAsync(input));
    } catch {
      throw invalidInput("Solve request contains input artifact metadata without canonical identity");
    }
  }
  const artifactIds = new Set<string>();
  const artifacts: { record: ArtifactRecord; payload: ArtifactPayload }[] = [];
  for (const candidate of parts.artifacts) {
    if (!candidate || typeof candidate !== "object" || !("record" in candidate) || !("payload" in candidate)) {
      throw invalidInput("Solver result contains an invalid generated artifact envelope");
    }
    let record: ArtifactRecord;
    try {
      record = await ArtifactRecordSchema.parseAsync(candidate.record);
    } catch {
      throw invalidInput("Solver result contains artifact metadata without canonical identity");
    }
    if (record.sourceRevision !== request.sourceRevision) {
      throw invalidInput("Generated artifact source revision does not match the solve request");
    }
    if (artifactIds.has(record.id)) throw invalidInput("Solver result contains duplicate generated artifact IDs");
    artifactIds.add(record.id);
    artifacts.push({ record, payload: candidate.payload });
  }
  const dependencyError = generatedArtifactDependencyError(
    { ...request, inputArtifacts: inputs },
    artifacts.map(({ record }) => record),
  );
  if (dependencyError) throw invalidInput(dependencyError);
  return { output: parts.output, truthLevel: parts.truthLevel, artifacts };
}
