import { createOcctCadAdapter } from "../cad/kernel/occt-adapter";
import type { CadEvaluationEvent, CadEvaluationRequest } from "../cad/runtime-contracts";

export function evaluateMechanismExactRequest(
  request: CadEvaluationRequest,
  signal: AbortSignal,
  emit: (event: CadEvaluationEvent) => void,
): Promise<void> {
  const adapter = createOcctCadAdapter();
  return (async () => {
    try {
      await adapter.evaluate(request, signal, emit);
    } finally {
      try { adapter.dispose?.(); } catch { /* preserve the evaluation outcome */ }
    }
  })();
}
