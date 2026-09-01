import type { ArtifactRecord } from "../cad/artifact-contract";
import { canonicalJson } from "../domain/canonical-json";
import { revisionId } from "../domain/revisions";
import { freezeSnapshot, type DeepReadonly } from "../domain/snapshots";
import {
  assertCompiledMechanismStudy, type CompiledMechanismStudy,
} from "./compile-mechanism-study";
import {
  MechanismWorkerResultEvidenceCandidateSchema, type MechanismReplay,
  type MechanismWorkerResultEvidenceCandidate,
} from "./mechanism-contract";
import { createMechanismReplay } from "./mechanism-replay";
import {
  createMechanismSolverClient, type MechanismSolverStarted, type MechanismSolverWorker,
} from "./mechanism-solver-client";
import {
  MECHANISM_SOLVER_WORKER_ASSET_URL, readMechanismSolverWorkerArtifactDigest,
} from "./mechanism-solver-artifact";
import { MechanismWorkerOutputSchema } from "./mechanism-solver-output";
import { codeUnitCompare } from "./mechanism-math";
import { assertMechanismSolverProvenance } from "./mechanism-solver-provenance";
import { mechanismVerification } from "./mechanism-verification";

export type MechanismResult = DeepReadonly<{
  sourceRevision: string; studyId: string; mechanismInputDigest: string;
  sourceArtifactIds: readonly string[];
  replay: MechanismReplay;
  evidence: MechanismWorkerResultEvidenceCandidate;
  truthLevel: "verified-mechanism-result";
  resultDigest: string;
}>;

const exactResults = new WeakMap<object, CompiledMechanismStudy>();
const cancelled = () => new DOMException("Mechanism solve was cancelled", "AbortError");
const abort = (signal: AbortSignal) => { if (signal.aborted) throw cancelled(); };

class BrowserMechanismSolverWorker implements MechanismSolverWorker {
  private readonly worker = new Worker(MECHANISM_SOLVER_WORKER_ASSET_URL, { type: "module" });
  postMessage(message: unknown, transfer?: readonly Transferable[]) { this.worker.postMessage(message, transfer ? [...transfer] : []); }
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void) {
    this.worker.addEventListener(type, listener as EventListener);
  }
  removeEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void) {
    this.worker.removeEventListener(type, listener as EventListener);
  }
  terminate() { this.worker.terminate(); }
}

const solveInWorker = createMechanismSolverClient(() => new BrowserMechanismSolverWorker());

export function assertMechanismResult(value: unknown): MechanismResult {
  if (!value || typeof value !== "object" || !exactResults.has(value)) {
    throw new Error("Expected in-process mechanism result authority");
  }
  return value as MechanismResult;
}

export function resolveMechanismResult(value: unknown): Readonly<{
  result: MechanismResult; compiled: CompiledMechanismStudy;
}> {
  const result = assertMechanismResult(value);
  return { result, compiled: exactResults.get(result)! };
}

export async function solveMechanismStudy(
  value: unknown, signal: AbortSignal,
  onStarted: (event: MechanismSolverStarted) => void = () => undefined,
): Promise<MechanismResult> {
  const compiled = assertCompiledMechanismStudy(value);
  abort(signal);
  const workerArtifactDigest = await readMechanismSolverWorkerArtifactDigest(signal);
  abort(signal);
  const output = MechanismWorkerOutputSchema.parse(await solveInWorker(compiled.input, signal, onStarted));
  abort(signal);
  const replay = await createMechanismReplay(compiled.input, output.replay);
  abort(signal);
  const evidence = MechanismWorkerResultEvidenceCandidateSchema.parse({
    ...output.evidence, replayDigest: replay.replayDigest,
  });
  if (evidence.mechanismInputDigest !== compiled.input.mechanismInputDigest) {
    throw new Error("Mechanism worker evidence does not match the compiled input");
  }
  await assertMechanismSolverProvenance(evidence, workerArtifactDigest, compiled.input.solverWork);
  abort(signal);
  if (canonicalJson(evidence.verification) !== canonicalJson(mechanismVerification(compiled.input, replay.frames))) {
    throw new Error("Mechanism worker verification does not match the validated replay");
  }
  const sourceArtifactIds = compiled.sourceArtifacts.map((artifact: ArtifactRecord) => artifact.id).sort(codeUnitCompare);
  const content = { sourceRevision: compiled.input.sourceRevision, studyId: compiled.input.studyId,
    mechanismInputDigest: compiled.input.mechanismInputDigest, sourceArtifactIds,
    replay, evidence, truthLevel: "verified-mechanism-result" as const };
  const result = freezeSnapshot({ ...content, resultDigest: await revisionId({
    ...content, replay: replay.replayDigest,
  }) });
  abort(signal);
  exactResults.set(result, compiled);
  return result;
}
