// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { initialDroneWorkspace } from "../assembly/drone-workspace";
import { compileLiveTopologyContext } from "../optimization/assembly-topology-input";
import { initSync, optimize_assembly_frame } from "./pkg/webmcp_reference.js";

describe("full live assembly Wasm solve", () => {
  it("completes the balanced reference solve with bounded resident-memory growth", () => {
    const wasm = readFileSync(new URL("./pkg/webmcp_reference_bg.wasm", import.meta.url));
    initSync({ module: wasm });
    const context = compileLiveTopologyContext(initialDroneWorkspace);
    const residentBefore = process.memoryUsage.rss();
    const startedAt = performance.now();

    const result = optimize_assembly_frame("balanced", context.input);
    const elapsedMs = performance.now() - startedAt;
    const residentGrowth = process.memoryUsage.rss() - residentBefore;

    try {
      expect({ width: result.width, height: result.height, depth: result.depth }).toEqual(
        context.grid.dimensions,
      );
      expect(result.density).toHaveLength(128 * 128 * 16);
      const caseStress = result.case_stress;
      const fieldLength = 128 * 128 * 16;
      expect(caseStress).toHaveLength(fieldLength * 4);
      const casePeaks = Array.from({ length: 4 }, (_, index) => caseStress
        .subarray(index * fieldLength, (index + 1) * fieldLength)
        .reduce((peak, value) => Math.max(peak, value), 0));
      expect(new Set(casePeaks.map((value) => value.toPrecision(6))).size).toBeGreaterThan(1);
      expect(residentGrowth).toBeLessThan(256 * 1024 * 1024);
      expect(elapsedMs).toBeLessThan(60_000);
    } finally {
      result.free();
    }
  }, 90_000);
});
