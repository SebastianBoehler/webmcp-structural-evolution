import { createOcctCadAdapter } from "../cad/kernel/occt-adapter";
import type { CadEvaluationEvent, CadEvaluationRequest } from "../cad/runtime-contracts";

export function evaluateMechanismExactRequest(
  request: CadEvaluationRequest,
  signal: AbortSignal,
  emit: (event: CadEvaluationEvent) => void,
): Promise<void> {
  return createOcctCadAdapter().evaluate(request, signal, emit);
}
