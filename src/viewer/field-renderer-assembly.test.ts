import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { extractAlternativeLayers } from "./alternative-instances";
import { mountFieldRenderer } from "./field-renderer";
import { visibleInstances } from "./field-instances";
import { alternative, current, harness, region } from "./field-viewer-test-support";
import type { AssemblyVisualPart } from "./render-envelope";

function model() {
  if (current.result.status !== "verified") throw new Error("fixture must be verified");
  return {
    grid: current.grid,
    currentInstances: visibleInstances(current.result.output, current.grid, 0.5),
    alternativeLayers: extractAlternativeLayers(current, [alternative], region, 0.5, "overlay").layers,
  };
}

describe("mountFieldRenderer assembly and capture", () => {
  it("updates mounted assembly roots without rebuilding their geometry", () => {
    const part = { id: "link", selectionId: "link", label: "Link", kind: "box" as const,
      size: [10, 10, 10] as const, center: [0, 0, 0] as const,
      appearance: "component" as const } satisfies AssemblyVisualPart;
    const test = harness();
    const session = mountFieldRenderer(document.createElement("canvas"), {
      ...model(), assemblyParts: [part],
    }, test.environment);
    session.setAssemblyPartPoses([{ ...part, center: [12, 34, 56], rotation: [0, .5, 0] }]);
    test.flushFrame();
    const scene = test.renderer.render.mock.calls.at(-1)?.[0] as THREE.Scene;
    const root = scene.getObjectByName("assembly-root:link")!;

    expect(root.position.toArray()).toEqual([12, 34, 56]);
    expect(root.rotation.y).toBeCloseTo(.5);
    session.dispose();
  });

  it("requests a retained WebGL drawing buffer only for an explicit gate capture without PNG retention", () => {
    const test = harness(), canvas = document.createElement("canvas");
    const toDataUrl = vi.fn(() => "data:image/png;base64,cmVuZGVyZWQ=");
    canvas.toDataURL = toDataUrl;
    const session = mountFieldRenderer(canvas, model(), test.environment, {},
      { preserveDrawingBuffer: true });
    test.flushFrame();

    expect(test.environment.createRenderer).toHaveBeenCalledWith(canvas, { preserveDrawingBuffer: true });
    expect(toDataUrl).not.toHaveBeenCalled();
    expect(canvas.style.backgroundImage).toBe("");
    session.dispose();
  });
});
