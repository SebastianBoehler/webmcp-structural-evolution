import { describe, expect, it, vi } from "vitest";

import { runMechanismBrowserGate } from "./browser-mechanism-gate";

describe("mechanism browser gate preflight", () => {
  it("blocks a rejected component preflight and restores the shared console capture", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const originalWarn = console.warn, originalError = console.error;
    try {
      const session = await runMechanismBrowserGate(new AbortController().signal, {
        componentEvidence: async () => { throw new Error("component preflight rejected"); },
      });

      expect(session.report).toMatchObject({ status: "blocked", blocker: {
        stage: "component-model-preflight", message: "component preflight rejected",
      }, solverPhaseConsole: { warningCount: 0, errorCount: 1 } });
      expect(console.warn).toBe(originalWarn);
      expect(console.error).toBe(originalError);
      expect(error).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
      error.mockRestore();
    }
  });
});
