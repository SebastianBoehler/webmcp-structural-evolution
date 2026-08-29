// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { initialDroneWorkspace } from "../assembly/drone-workspace";
import { compileLiveTopologyContext } from "../optimization/assembly-topology-input";
import { compileAssemblyTopologyContext } from "../optimization/assembly-study-compiler";
import type { AssemblyTopologyInput, SolverVolume } from "../optimization/topology-contract";
import { SE6_COBOT_FIXTURE } from "../samples/cobot/cobot-fixture";
import { initSync, optimize_assembly_frame } from "./pkg/webmcp_reference.js";

function thresholdPathExists(
  density: Float32Array,
  dimensions: readonly [number, number, number],
  starts: readonly number[],
  goals: ReadonlySet<number>,
) {
  const [width, height, depth] = dimensions;
  const seen = new Uint8Array(density.length);
  const queue = [...starts];
  starts.forEach((index) => { seen[index] = 1; });
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]!;
    if (goals.has(index)) return true;
    const z = Math.floor(index / (width * height));
    const row = index - z * width * height;
    const y = Math.floor(row / width);
    const x = row - y * width;
    for (const [nx, ny, nz] of [[x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1]]) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || nz < 0 || nz >= depth) continue;
      const neighbor = nx + width * (ny + height * nz);
      if (!seen[neighbor] && density[neighbor]! >= 0.32) {
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }
  return false;
}

function voxelIndicesInside(volume: SolverVolume, grid: AssemblyTopologyInput["grid"]) {
  const { width, height, depth } = grid.dimensions;
  const indices: number[] = [];
  for (let z = 0; z < depth; z += 1) for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const center = [x, y, z].map((coordinate, axis) =>
      grid.originM[axis]! + (coordinate + 0.5) * grid.cellSizeM[axis]!);
    const dx = center[0]! - volume.centerM[0], dy = center[1]! - volume.centerM[1], dz = center[2]! - volume.centerM[2];
    const cosine = Math.cos(-volume.yawRad), sine = Math.sin(-volume.yawRad);
    const local = [cosine * dx - sine * dy, sine * dx + cosine * dy, dz];
    const inside = volume.kind === "box"
      ? local.every((value, axis) => Math.abs(value) <= volume.sizeM![axis]! / 2)
      : Math.hypot(local[0]!, local[1]!) <= volume.radiusM! && Math.abs(local[2]!) <= volume.heightM! / 2;
    if (inside) indices.push(x + width * (y + height * z));
  }
  return indices;
}

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

  it("solves the SE-6 upper arm and preserves its named load cases across Wasm", () => {
    const wasm = readFileSync(new URL("./pkg/webmcp_reference_bg.wasm", import.meta.url));
    initSync({ module: wasm });
    const fixture = SE6_COBOT_FIXTURE;
    const context = compileAssemblyTopologyContext(fixture.workspace, fixture.study);

    const result = optimize_assembly_frame("balanced", context.input);

    try {
      const fieldLength = 48 * 32 * 16;
      expect(result.case_ids).toEqual([
        "rated-payload-gravity", "emergency-stop", "lateral-disturbance",
      ]);
      expect(result.density).toHaveLength(fieldLength);
      expect(result.case_displacement).toHaveLength(fieldLength * 3);
      expect(result.case_stress).toHaveLength(fieldLength * 3);
      expect(result.final_compliance).toBeGreaterThan(0);
      const [width, height, depth] = [48, 32, 16] as const;
      const region = (xCenter: number) => Array.from({ length: fieldLength }, (_, index) => index).filter((index) => {
        const z = Math.floor(index / (width * height));
        const row = index - z * width * height;
        const y = Math.floor(row / width);
        const x = row - y * width;
        return Math.abs(x - xCenter) <= 4 && Math.abs(y - height / 2) <= 7 && Math.abs(z - depth / 2) <= 3
          && result.density[index]! >= 0.32;
      });
      const base = region(4);
      const payload = new Set(region(43));
      expect(base.length).toBeGreaterThan(0);
      expect(payload.size).toBeGreaterThan(0);
      expect(thresholdPathExists(result.density, [width, height, depth], base, payload)).toBe(true);
      const voidIndices = [...context.input.protectedVoids, ...context.input.accessVoids]
        .flatMap((volume) => voxelIndicesInside(volume, context.input.grid));
      expect(voidIndices.length).toBeGreaterThan(0);
      expect(Math.max(...voidIndices.map((index) => result.density[index]!))).toBeLessThan(0.32);
    } finally {
      result.free();
    }
  }, 90_000);
});
