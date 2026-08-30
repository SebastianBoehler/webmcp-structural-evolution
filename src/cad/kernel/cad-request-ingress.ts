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
    const requestId = typeof request?.requestId === "string" && request.requestId.length > 0
      ? request.requestId
      : "unknown-request";
    emit(CadEvaluationEventSchema.parse({
      requestId, state: "failed",
      error: {
        code: "invalid-document",
        message: error instanceof Error ? error.message : "Invalid CAD document",
      },
    }));
    return undefined;
  }
}
