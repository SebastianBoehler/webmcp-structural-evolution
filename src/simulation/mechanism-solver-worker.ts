import { runRapierMechanism } from "./mechanism-solver-kernel";
import { fetchArtifactDigest } from "./mechanism-solver-digest";
import { MechanismWorkerOutputSchema } from "./mechanism-solver-output";
import { MECHANISM_ENGINE_VERSION, mechanismSolverProvenance } from "./mechanism-solver-provenance";
import { createMechanismSolverWorkerRuntime } from "./mechanism-solver-worker-runtime";

const scope = self as unknown as Parameters<typeof createMechanismSolverWorkerRuntime>[0];

createMechanismSolverWorkerRuntime(scope, async (input, signal) => {
  const solved = await runRapierMechanism(input, signal);
  if (signal.aborted) throw new DOMException("cancelled", "AbortError");
  if (solved.engineVersion !== MECHANISM_ENGINE_VERSION) {
    throw new Error("Rapier did not report the pinned deterministic engine version");
  }
  const workerArtifactDigest = await fetchArtifactDigest(import.meta.url, signal);
  if (signal.aborted) throw new DOMException("cancelled", "AbortError");
  const provenance = await mechanismSolverProvenance(workerArtifactDigest);
  if (signal.aborted) throw new DOMException("cancelled", "AbortError");
  return MechanismWorkerOutputSchema.parse({ replay: solved.replay, evidence: {
    mechanismInputDigest: solved.replay.mechanismInputDigest,
    ...provenance, verification: solved.verification,
  } });
});
