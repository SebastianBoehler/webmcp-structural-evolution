import { afterEach, describe, expect, it, vi } from "vitest";

import { createGateConsoleAudit } from "./browser-gpu-audit";

describe("live gate console capture", () => {
  afterEach(() => vi.restoreAllMocks());

  it("captures warnings and errors, calls through, and restores out of order", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = createGateConsoleAudit(), second = createGateConsoleAudit();
    console.warn("warning");
    first.restore();
    console.error("error");
    expect(first.evidence()).toEqual({ warningCount: 1, errorCount: 0 });
    expect(second.evidence()).toEqual({ warningCount: 1, errorCount: 1 });
    second.restore();
    console.error("after restore");
    expect(warning).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("restores idempotently", () => {
    const audit = createGateConsoleAudit();
    audit.restore();
    audit.restore();
    expect(audit.evidence()).toEqual({ warningCount: 0, errorCount: 0 });
  });
});
