import { afterEach, describe, expect, it, vi } from "vitest";

import {
  rasterizeStructuralBoundaries, rasterizeStructuralBoundariesDirect,
} from "./structural-boundary-raster";
import type { OwnedTriangle, Point3 } from "./triangle-voxel-geometry";

const triangle = (a: Point3, b: Point3, c: Point3, topologyId: string): OwnedTriangle => ({
  a, b, c, topologyId, bodyId: "body",
});

function box(rightBottom = 1, rightTop = 1): OwnedTriangle[] {
  const p = {
    a: [0, 0, 0], b: [rightBottom, 0, 0], c: [rightTop, 1, 0], d: [0, 1, 0],
    e: [0, 0, 1], f: [rightBottom, 0, 1], g: [rightTop, 1, 1], h: [0, 1, 1],
  } as const;
  return [
    triangle(p.a, p.c, p.b, "bottom"), triangle(p.a, p.d, p.c, "bottom"),
    triangle(p.e, p.f, p.g, "top"), triangle(p.e, p.g, p.h, "top"),
    triangle(p.a, p.b, p.f, "front"), triangle(p.a, p.f, p.e, "front"),
    triangle(p.d, p.h, p.g, "back"), triangle(p.d, p.g, p.c, "back"),
    triangle(p.a, p.e, p.h, "fixed"), triangle(p.a, p.h, p.d, "fixed"),
    triangle(p.b, p.c, p.g, "z-loaded"), triangle(p.b, p.g, p.f, "z-loaded"),
  ];
}

const input = (triangles: OwnedTriangle[], topologyIds = ["fixed", "z-loaded"]) => ({
  topologyIds, triangles, activeCells: Uint32Array.of(1),
  dimensions: [1, 1, 1] as const, originM: [0, 0, 0] as const,
  cellSizeM: 1, toleranceM: 1e-6,
});

describe("exposed structural facet ownership", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("derives four lattice nodes from an oblique semantic exit face", () => {
    const output = rasterizeStructuralBoundariesDirect(input(box(1.2, .8)));
    expect(output.cells[1]).toEqual([0]);
    expect(output.nodes[1]).toEqual([1, 3, 5, 7]);
  });

  it("breaks equal-hit seam ownership independently of triangle order", () => {
    const source = box();
    const seam = source.filter(({ topologyId }) => topologyId === "z-loaded")
      .map((value) => ({ ...value, topologyId: "a-loaded" }));
    const first = rasterizeStructuralBoundariesDirect(input([...source, ...seam], ["a-loaded"]));
    const second = rasterizeStructuralBoundariesDirect(input([...seam].reverse().concat(source), ["a-loaded"]));
    expect(first).toEqual(second);
    expect(first).toEqual({ cells: [[0]], nodes: [[1, 3, 5, 7]] });
  });

  it("quarantines a mid-flight worker abort and a fresh direct run recovers", async () => {
    const workers: Array<{ terminated: boolean }> = [];
    class FakeWorker {
      terminated = false;
      private readonly messages: Array<(event: MessageEvent) => void> = [];
      constructor() { workers.push(this); }
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === "message") this.messages.push(listener);
      }
      postMessage(message: { requestId: string }) {
        setTimeout(() => this.messages.forEach((listener) => listener({
          data: { requestId: message.requestId, output: { cells: [[0]], nodes: [[1, 3, 5, 7]] } },
        } as MessageEvent)), 0);
      }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const pending = rasterizeStructuralBoundaries(input(box()), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated).toBe(true);
    vi.unstubAllGlobals();
    expect(rasterizeStructuralBoundariesDirect(input(box())).cells).toEqual([[0], [0]]);
  });
});
