import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as THREE from "three";
import { afterEach, expect, test, vi } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";
import { harness } from "../viewer/field-viewer-test-support";
import { FoundationJourney } from "./FoundationJourney";

function estimate(input: ProbeInput): ProbeResult {
  const output = new Float32Array(input.values.length);
  for (let index = 0; index < Math.min(output.length, 64); index += 8) output[index] = 0.5;
  return {
    status: "estimate",
    truthLevel: "interactive-estimate",
    output,
    elapsedMs: 8,
    relativeL2: 0,
    tolerance: 0.000005,
    topology: {
      solver: "sparse-simp-lattice-wasm",
      initialCompliance: 4,
      finalCompliance: 2,
      maxDisplacement: 0.001,
      maxStress: 10,
      minimumSafetyFactor: 2,
      materialFraction: 0.5,
      iterations: 4,
    },
    analysis: { displacement: output.slice(), stress: output.slice() },
  };
}

function scene(viewer: ReturnType<typeof harness>): THREE.Scene {
  viewer.flushFrame();
  return viewer.renderer.render.mock.calls.at(-1)?.[0] as THREE.Scene;
}

function topology(viewer: ReturnType<typeof harness>): THREE.Mesh {
  return scene(viewer).getObjectByName("verified-topology-surface") as THREE.Mesh;
}

function hasAssemblyPart(viewer: ReturnType<typeof harness>): boolean {
  let found = false;
  scene(viewer).traverse(({ name }) => { if (name.startsWith("assembly-part:")) found = true; });
  return found;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("keeps the generated estimate topology visible across simulation views and replay", async () => {
  let replayFrame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    replayFrame = callback;
    return 41;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const viewer = harness();
  render(<FoundationJourney
    capability={{ status: "available", message: "Test adapter acquired." }}
    compute={async (input) => estimate(input)}
    viewerEnvironment={viewer.environment}
  />);

  fireEvent.click(screen.getByRole("button", { name: /^optimize$/i }));
  fireEvent.click(screen.getByRole("button", { name: /generate balanced frame/i }));
  await screen.findByRole("button", { name: /review interactive estimate/i });
  fireEvent.click(screen.getByRole("button", { name: /^simulate$/i }));

  expect(screen.getByRole("img", {
    name: /interactive 3d physical assembly and interactive estimate preview density field/i,
  })).toBeVisible();
  expect(screen.getByText(/interactive estimate.*unverified.*unaccepted/i)).toBeVisible();
  expect(topology(viewer)).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: "Frame only" }));
  expect(topology(viewer)).toBeDefined();
  expect(hasAssemblyPart(viewer)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Full assembly" }));
  expect(topology(viewer)).toBeDefined();
  expect(hasAssemblyPart(viewer)).toBe(true);

  for (const layer of ["Stress", "Displacement"] as const) {
    fireEvent.click(screen.getByRole("button", { name: layer }));
    expect(screen.getByRole("button", { name: layer }).getAttribute("aria-pressed")).toBe("true");
    expect(topology(viewer)).toBeDefined();
    expect(topology(viewer).geometry.getAttribute("color")).toBeDefined();
  }

  fireEvent.click(screen.getByRole("button", { name: /run flight replay/i }));
  const surface = topology(viewer);
  act(() => replayFrame?.(performance.now() + 250));
  expect(topology(viewer)).toBe(surface);
});
