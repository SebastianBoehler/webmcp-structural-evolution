import { describe, expect, it } from "vitest";

import type { CadEvaluationEvent } from "../runtime-contracts";
import { verifiedCadEvaluationRequest } from "./cad-request-ingress";

describe("CAD request ingress", () => {
  it("uses a schema-valid fallback ID for malformed runtime requests", async () => {
    const events: CadEvaluationEvent[] = [];

    await expect(verifiedCadEvaluationRequest(
      { requestId: 42 } as never,
      (event) => events.push(event),
    )).resolves.toBeUndefined();

    expect(events).toEqual([{
      requestId: "unknown-request",
      state: "failed",
      error: { code: "invalid-document", message: expect.any(String) },
    }]);
  });
});
