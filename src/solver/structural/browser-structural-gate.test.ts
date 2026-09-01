import { describe, expect, it } from "vitest";

import {
  gateReportAuthorizesManufacturing, isLiveStructuralGateCapability,
  parseStructuralTopologyGateReport, runStructuralTopologyBrowserGateSession,
  serializeLiveAcceptedTopologyStl,
} from "./browser-structural-gate";

describe("structural and topology browser gate report", () => {
  it("rejects an automated report without live WebGPU authority", () => {
    expect(() => parseStructuralTopologyGateReport({
      status: "passed", evidenceSource: "automated-recording-device",
      realGpu: false, promoted: false,
    })).toThrow("live browser");
  });

  it("rejects a report shell that omits assigned component evidence", () => {
    expect(() => parseStructuralTopologyGateReport({
      status: "passed", evidenceSource: "automated-recording-device",
      realGpu: false, promoted: false,
      topology: {},
    })).toThrow("SE-6 topology");
  });

  it("accepts a serializable blocked report only with an exact blocker", () => {
    expect(parseStructuralTopologyGateReport({
      status: "blocked", evidenceSource: "live-browser-webgpu",
      blocker: { stage: "webgpu-acquisition", message: "navigator.gpu is unavailable" },
      console: { statusLines: [], warningCount: 0, errorCount: 1 },
    })).toEqual(expect.objectContaining({ status: "blocked" }));
    expect(() => parseStructuralTopologyGateReport({
      status: "blocked", evidenceSource: "live-browser-webgpu",
      blocker: { stage: "", message: "" }, console: { statusLines: [], warningCount: 0, errorCount: 0 },
    })).toThrow("blocker");
  });

  it("settles rejected authoritative component documents into blocked evidence", async () => {
    const session = await runStructuralTopologyBrowserGateSession(undefined, {
      loadDocuments: async () => { throw new Error("component documents rejected"); },
    });

    expect(session).toMatchObject({ models: [], report: { status: "blocked", blocker: {
      stage: "component-model-preflight", message: "component documents rejected",
    }, console: { statusLines: [], warningCount: 0, errorCount: 0 } } });
  });

  it("never treats a serialized audit report or copied capability shape as authority", () => {
    const report = parseStructuralTopologyGateReport({
      status: "blocked", evidenceSource: "live-browser-webgpu",
      blocker: { stage: "test", message: "audit only" },
      console: { statusLines: [], warningCount: 0, errorCount: 0 },
    });
    expect(gateReportAuthorizesManufacturing(report)).toBe(false);
    expect(isLiveStructuralGateCapability({ sessionId: "a".repeat(64) })).toBe(false);
    expect(() => serializeLiveAcceptedTopologyStl({ sessionId: "a".repeat(64) }, "drone" as never))
      .toThrow(/session-bound Task 5 capability/i);
    expect(() => serializeLiveAcceptedTopologyStl({ sessionId: "a".repeat(64) }, "unknown" as never))
      .toThrow(/session-bound Task 5 capability/i);
    expect(isLiveStructuralGateCapability(structuredClone({ sessionId: "a".repeat(64) }))).toBe(false);
    expect(isLiveStructuralGateCapability(new Proxy({ sessionId: "a".repeat(64) }, {}))).toBe(false);
    expect(() => serializeLiveAcceptedTopologyStl({ sessionId: "b".repeat(64) }, "cobot"))
      .toThrow(/session-bound Task 5 capability/i);
  });
});
