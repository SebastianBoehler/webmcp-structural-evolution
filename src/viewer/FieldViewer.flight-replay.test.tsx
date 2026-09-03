import { cleanup, render, screen } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ViewerBranch } from "./alternative-instances";
import { FieldViewer } from "./FieldViewer";
import { current, grid, harness, region } from "./field-viewer-test-support";
import type { AssemblyVisualPart } from "./render-envelope";
import { createFlightFrameChannel } from "../simulation/flight-frame-channel";
import { flightFrameAt } from "../simulation/flight-scenarios";

const part: AssemblyVisualPart = {
  id: "motor-envelope", selectionId: "motor", label: "Motor", appearance: "component",
  kind: "cylinder", center: [8, 0, 2], radius: 2, height: 4, movable: true,
};
const loadVectors: readonly AssemblyVisualPart[] = [
  ["east", [105, 0, 0]], ["north", [0, 105, 0]],
  ["west", [-105, 0, 0]], ["south", [0, -105, 0]],
].map(([id, center]) => ({
  id: `${id}-load-vector`, selectionId: String(id), label: `${id} solver load`,
  appearance: "generated" as const, kind: "load-vector" as const,
  center: center as [number, number, number], forceN: [0, 0, -18] as const, length: 28,
}));

function renderedScene(test: ReturnType<typeof harness>): THREE.Scene {
  test.flushFrame();
  return test.renderer.render.mock.calls.at(-1)?.[0] as THREE.Scene;
}

describe("FieldViewer flight replay", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("streams flight frames into one persistent WebGL scene without remount flashes", () => {
    const test = harness();
    const channel = createFlightFrameChannel();
    render(<FieldViewer
      current={null} alternatives={[]} selectedRegion={region} threshold={0.5} mode="overlay"
      grid={grid} assemblyParts={[part]} flightFrameSource={channel} environment={test.environment}
    />);
    channel.emit(flightFrameAt("roll", 0.25, [
      { id: "east", centerM: [0.105, 0, 0] }, { id: "north", centerM: [0, 0.105, 0] },
      { id: "west", centerM: [-0.105, 0, 0] }, { id: "south", centerM: [0, -0.105, 0] },
    ], 0.495));

    expect(renderedScene(test).getObjectByName("flight-replay-root")!.rotation.x).toBeCloseTo(0.34);
    expect(test.environment.createRenderer).toHaveBeenCalledTimes(1);
  });

  it("keeps the replay renderer mounted when frame ticks supply fresh empty alternatives", () => {
    const test = harness();
    const catalog = [part] as const;
    const view = render(<FieldViewer
      current={null} alternatives={[]} selectedRegion={region} threshold={0.5} mode="overlay"
      grid={grid} assemblyParts={catalog} assemblyPoseParts={catalog} environment={test.environment}
    />);
    const mountedRoot = renderedScene(test).getObjectByName("assembly-root:motor-envelope")!;
    const mountedMesh = mountedRoot.getObjectByName("assembly-part:motor-envelope") as THREE.Mesh;
    const mountedGeometry = mountedMesh.geometry;

    for (const center of [[10, 0, 0], [20, 0, 0], [30, 0, 0]] as const) {
      view.rerender(<FieldViewer
        current={null} alternatives={[]} selectedRegion={region} threshold={0.5} mode="overlay"
        grid={grid} assemblyParts={catalog} assemblyPoseParts={[{ ...part, center }]}
        environment={test.environment}
      />);
    }

    expect(test.environment.createRenderer).toHaveBeenCalledTimes(1);
    const replayRoot = renderedScene(test).getObjectByName("assembly-root:motor-envelope")!;
    const replayMesh = replayRoot.getObjectByName("assembly-part:motor-envelope") as THREE.Mesh;
    expect(replayRoot).toBe(mountedRoot);
    expect(replayMesh).toBe(mountedMesh);
    expect(replayMesh.geometry).toBe(mountedGeometry);
  });

  it("stacks status, transform, and orientation as independent narrow gate rows", () => {
    const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      const test = harness();
      render(<div style={{ width: 390, height: 400 }}><FieldViewer
        current={null} alternatives={[]} selectedRegion={region} threshold={0.5} mode="overlay"
        grid={grid} assemblyParts={[part]} preserveDrawingBuffer
        statusText="Passive force response · frame 120/120 · clearance evidence retained"
        environment={test.environment}
      /></div>);

      const status = screen.getByText(/passive force response/i);
      const transform = screen.getByRole("group", { name: "CAD display and transforms" });
      const orientation = screen.getByRole("group", { name: "Viewport orientation" });
      const stack = screen.getByLabelText("Viewport status and controls");
      expect([status, transform, orientation].every((row) => row.parentElement === stack)).toBe(true);
      expect([...stack.children]).toEqual([status, transform, orientation]);
      expect(new Set([status, transform, orientation]).size).toBe(3);
    } finally {
      if (width) Object.defineProperty(window, "innerWidth", width);
    }
  });

  it("recolors the structural surface from the active replay load case instead of a static envelope", () => {
    const test = harness();
    const channel = createFlightFrameChannel();
    const caseAware = {
      ...current,
      result: {
        ...current.result,
        topology: {
          solver: "sparse-simp-lattice-wasm", initialCompliance: 10, finalCompliance: 4,
          maxDisplacement: 1, maxStress: 10, minimumSafetyFactor: 5, materialFraction: 0.5, iterations: 8,
        },
        analysis: {
          displacement: new Float32Array(4), stress: new Float32Array(4),
          cases: { "roll-differential": {
            displacement: new Float32Array([0, 0.2, 0, 1]), stress: new Float32Array([0, 10, 0, 2]),
            displacementVectorsM: new Float32Array([
              .001, 0, 0, .002, 0, 0, .001, 0, 0, .002, 0, 0,
            ]),
          } },
        },
      },
    } as unknown as ViewerBranch;
    render(<FieldViewer
      current={caseAware} alternatives={[]} selectedRegion={region} threshold={0.5} mode="overlay"
      analysisLayer="stress" assemblyParts={loadVectors} flightFrameSource={channel}
      environment={test.environment}
    />);
    const surface = renderedScene(test).getObjectByName("verified-topology-surface") as THREE.Mesh;
    const geometry = surface.geometry;
    const material = surface.material;
    const before = Array.from(surface.geometry.getAttribute("color").array);
    const beforePositions = Array.from(surface.geometry.getAttribute("position").array);

    channel.emit(flightFrameAt("roll", 0.25, [
      { id: "east", centerM: [0.105, 0, 0] }, { id: "north", centerM: [0, 0.105, 0] },
      { id: "west", centerM: [-0.105, 0, 0] }, { id: "south", centerM: [0, -0.105, 0] },
    ], 0.495));
    expect(Array.from(surface.geometry.getAttribute("color").array)).not.toEqual(before);
    expect(Array.from(surface.geometry.getAttribute("position").array)).not.toEqual(beforePositions);
    expect(surface.userData.deformationScale).not.toBe(0);

    channel.emit(undefined);
    expect(Array.from(surface.geometry.getAttribute("color").array)).toEqual(before);
    expect(Array.from(surface.geometry.getAttribute("position").array)).toEqual(beforePositions);
    channel.emit(flightFrameAt("roll", 0, [
      { id: "east", centerM: [0.105, 0, 0] }, { id: "north", centerM: [0, 0.105, 0] },
      { id: "west", centerM: [-0.105, 0, 0] }, { id: "south", centerM: [0, -0.105, 0] },
    ], 0.495));
    const cold = new THREE.Color(0x16b9ff).toArray();
    const zeroAmplitude = Array.from(surface.geometry.getAttribute("color").array);
    for (let index = 0; index < zeroAmplitude.length; index += 3) {
      zeroAmplitude.slice(index, index + 3).forEach((value, axis) => {
        expect(value).toBeCloseTo(cold[axis]!, 6);
      });
    }
    for (let frame = 1; frame <= 24; frame += 1) {
      channel.emit(flightFrameAt("roll", frame / 24, [
        { id: "east", centerM: [0.105, 0, 0] }, { id: "north", centerM: [0, 0.105, 0] },
        { id: "west", centerM: [-0.105, 0, 0] }, { id: "south", centerM: [0, -0.105, 0] },
      ], 0.495));
    }
    const replaySurface = renderedScene(test).getObjectByName("verified-topology-surface") as THREE.Mesh;
    expect(replaySurface).toBe(surface);
    expect(replaySurface.geometry).toBe(geometry);
    expect(replaySurface.material).toBe(material);
    expect(test.environment.createRenderer).toHaveBeenCalledTimes(1);
  });
});
