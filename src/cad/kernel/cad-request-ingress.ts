import {
  CadEvaluationEventSchema,
  defineCadEvaluationRequest,
  type CadEvaluationEvent,
  type CadEvaluationRequest,
} from "../runtime-contracts";

export async function verifiedCadEvaluationRequest(
  request: CadEvaluationRequest,
  emit: (event: CadEvaluationEvent) => void,
): Promise<CadEvaluationRequest | undefined> {
  try {
    return await defineCadEvaluationRequest(request);
  } catch (error) {
    emit(CadEvaluationEventSchema.parse({
      requestId: request.requestId || "unknown-request", state: "failed",
      error: {
        code: "invalid-document",
        message: error instanceof Error ? error.message : "Invalid CAD document",
      },
    }));
    return undefined;
  }
}
