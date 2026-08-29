import { describe, expect, it } from "vitest";

describe("CAD public API", () => {
  it("exports the documented document, transaction, and session entry points", async () => {
    const api = await import("./index");

    expect(Object.keys(api)).toEqual(expect.arrayContaining([
      "createDesignDocument",
      "applyDesignTransaction",
      "createDesignSession",
      "applyDesignSessionTransaction",
      "inspectDesignSession",
      "CadEvaluationRequestSchema",
      "EngineeringJobRequestSchema",
    ]));
    expect(Object.keys(api)).not.toEqual(expect.arrayContaining([
      "referenceFpvDrone",
      "useProjectState",
      "WebGLRenderer",
    ]));
  });
});
