import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ViewerBranch } from "./alternative-instances";
import { FieldViewer } from "./FieldViewer";
import {
  alternative,
  current,
  grid,
  harness,
  region,
  renderedMeshes,
} from "./field-viewer-test-support";
import type { AssemblyVisualPart } from "./render-envelope";
import { createFlightFrameChannel } from "../simulation/flight-frame-channel";
import { flightFrameAt } from "../simulation/flight-scenarios";

const part: AssemblyVisualPart = {
  id: "motor-envelope",
  selectionId: "motor",
  label: "Motor",
  appearance: "component",
  kind: "cylinder",
  center: [8, 0, 2],
  radius: 2,
  height: 4,
  movable: true,
};

const loadVectorCenters: readonly (readonly [string, readonly [number, number, number]])[] = [
  ["east", [105, 0, 0]],
  ["north", [0, 105, 0]],
  ["west", [-105, 0, 0]],
  ["south", [0, -105, 0]],
];
const loadVectors: readonly AssemblyVisualPart[] = loadVectorCenters.map(([id, center]) => ({
  id: `${id}-load-vector`,
  selectionId: String(id),
  label: `${id} solver load`,
  appearance: "generated" as const,
  kind: "load-vector" as const,
  center,
  forceN: [0, 0, -18] as const,
  length: 28,
}));

function renderedScene(test: ReturnType<typeof harness>): THREE.Scene {
  test.flushFrame();
  return test.renderer.render.mock.calls.at(-1)?.[0] as THREE.Scene;
}

describe("FieldViewer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the exact assembly before compute and exposes concise interaction guidance", () => {
    const test = harness();
    render(
      <FieldViewer
        current={null}
        alternatives={[]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        grid={grid}
        assemblyParts={[part]}
        selectedPart="motor"
        environment={test.environment}
      />,
    );

    expect(screen.getByRole("img", { name: /interactive 3d physical assembly/i })).toBeVisible();
    expect(screen.getByText(/select a part.*x\/y\/z move.*orbit.*scroll zoom/i)).toBeVisible();
    expect(screen.getByRole("status").textContent).toMatch(/assembly ready/i);
    const motor = renderedScene(test).getObjectByName("assembly-part:motor-envelope") as THREE.Mesh;
    expect(motor).toBeDefined();
    expect((motor.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.9);
  });

  it("renders a smooth isosurface while retaining hidden voxel evidence", () => {
    const test = harness();
    render(<FieldViewer
      current={current}
      alternatives={[]}
      selectedRegion={region}
      threshold={0.5}
      mode="overlay"
      environment={test.environment}
    />);

    const scene = renderedScene(test);
    expect(scene.getObjectByName("verified-topology-surface")).toBeDefined();
    expect((scene.getObjectByName("verified-current-field") as THREE.InstancedMesh).visible).toBe(false);
  });

  it("uses familiar CAD orientation, grid, coordinate-space, and snapping controls", () => {
    const test = harness();
    render(
      <FieldViewer
        current={null}
        alternatives={[]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        grid={grid}
        assemblyParts={[part]}
        selectedPart="motor"
        environment={test.environment}
      />,
    );

    expect(screen.getByRole("group", { name: "Viewport orientation" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Isometric view" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Toggle reference grid" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "World coordinates" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Snap 10 millimetres" }).getAttribute("aria-pressed")).toBe("true");
    expect(renderedScene(test).getObjectByName("cad-world-grid")).toBeDefined();
    expect(renderedScene(test).getObjectByName("cad-transform-gizmo")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Top view" }));
    test.flushFrame();
    const camera = test.renderer.render.mock.calls.at(-1)?.[1] as THREE.PerspectiveCamera;
    const [targetX, targetY, targetZ] = test.controls.target.set.mock.calls.at(-1)!;
    expect(camera.position.x).toBeCloseTo(targetX);
    expect(camera.position.y).toBeCloseTo(targetY);
    expect(camera.position.z).toBeGreaterThan(targetZ);
  });

  it("can re-anchor navigation on the selected component and documents free pan", () => {
    const test = harness();
    render(
      <FieldViewer
        current={null}
        alternatives={[]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        grid={grid}
        assemblyParts={[part]}
        selectedPart="motor"
        environment={test.environment}
      />,
    );

    expect(screen.getByText(/right-drag.*pan/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Focus selected part" }));
    expect(test.controls.target.set).toHaveBeenLastCalledWith(8, 0, 2);
  });

  it("streams flight frames into one persistent WebGL scene without remount flashes", () => {
    const test = harness();
    const channel = createFlightFrameChannel();
    render(<FieldViewer
      current={null}
      alternatives={[]}
      selectedRegion={region}
      threshold={0.5}
      mode="overlay"
      grid={grid}
      assemblyParts={[part]}
      flightFrameSource={channel}
      environment={test.environment}
    />);
    channel.emit(flightFrameAt("roll", 0.25, [
      { id: "east", centerM: [0.105, 0, 0] },
      { id: "north", centerM: [0, 0.105, 0] },
      { id: "west", centerM: [-0.105, 0, 0] },
      { id: "south", centerM: [0, -0.105, 0] },
    ], 0.495));
    const replayRoot = renderedScene(test).getObjectByName("flight-replay-root")!;
    expect(replayRoot.rotation.x).toBeCloseTo(0.34);
    expect(test.environment.createRenderer).toHaveBeenCalledTimes(1);
  });

  it("recolors the structural surface from the active replay load case instead of a static envelope", () => {
    const test = harness();
    const channel = createFlightFrameChannel();
    const caseAware = {
      ...current,
      result: {
        ...current.result,
        topology: {
          solver: "sparse-simp-lattice-wasm",
          initialCompliance: 10,
          finalCompliance: 4,
          maxDisplacement: 1,
          maxStress: 10,
          minimumSafetyFactor: 5,
          materialFraction: 0.5,
          iterations: 8,
        },
        analysis: {
          displacement: new Float32Array(4),
          stress: new Float32Array(4),
          cases: {
            "roll-differential": {
              displacement: new Float32Array([0, 0.2, 0, 1]),
              stress: new Float32Array([0, 10, 0, 2]),
            },
          },
        },
      },
    } as unknown as ViewerBranch;
    render(<FieldViewer
      current={caseAware}
      alternatives={[]}
      selectedRegion={region}
      threshold={0.5}
      mode="overlay"
      analysisLayer="stress"
      assemblyParts={loadVectors}
      flightFrameSource={channel}
      environment={test.environment}
    />);
    const surface = renderedScene(test).getObjectByName("verified-topology-surface") as THREE.Mesh;
    const before = Array.from(surface.geometry.getAttribute("color").array);

    channel.emit(flightFrameAt("roll", 0.25, [
      { id: "east", centerM: [0.105, 0, 0] },
      { id: "north", centerM: [0, 0.105, 0] },
      { id: "west", centerM: [-0.105, 0, 0] },
      { id: "south", centerM: [0, -0.105, 0] },
    ], 0.495));

    const after = Array.from(surface.geometry.getAttribute("color").array);
    expect(after).not.toEqual(before);

    channel.emit(undefined);
    expect(Array.from(surface.geometry.getAttribute("color").array)).toEqual(before);

    channel.emit(flightFrameAt("roll", 0, [
      { id: "east", centerM: [0.105, 0, 0] },
      { id: "north", centerM: [0, 0.105, 0] },
      { id: "west", centerM: [-0.105, 0, 0] },
      { id: "south", centerM: [0, -0.105, 0] },
    ], 0.495));
    const cold = new THREE.Color(0x16b9ff).toArray();
    const zeroAmplitude = Array.from(surface.geometry.getAttribute("color").array);
    for (let index = 0; index < zeroAmplitude.length; index += 3) {
      zeroAmplitude.slice(index, index + 3).forEach((value, axis) => {
        expect(value).toBeCloseTo(cold[axis]!, 6);
      });
    }
    expect(test.environment.createRenderer).toHaveBeenCalledTimes(1);
  });

  it("renders one solid field plus one ghost per compatible alternative", () => {
    const test = harness();
    render(
      <FieldViewer
        current={current}
        alternatives={[alternative, { ...alternative, branchRevision: "stiffer" }]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        environment={test.environment}
      />,
    );

    expect(renderedMeshes(test)).toHaveLength(3);
    expect(screen.getByRole("status").textContent).toMatch(/verified field.*arm rib/i);
  });

  it("auditions one exact alternative without mutating either field", () => {
    const test = harness();
    const currentBefore = Array.from(current.result.status === "verified" ? current.result.output : []);
    const alternativeBefore = Array.from(alternative.result.status === "verified" ? alternative.result.output : []);
    render(
      <FieldViewer
        current={current}
        alternatives={[alternative]}
        selectedRegion={region}
        threshold={0.5}
        mode="audition"
        selectedAlternative="lighter"
        environment={test.environment}
      />,
    );

    expect(renderedMeshes(test)).toHaveLength(1);
    expect(renderedMeshes(test)[0]?.count).toBe(3);
    expect(Array.from(current.result.status === "verified" ? current.result.output : [])).toEqual(currentBefore);
    expect(Array.from(alternative.result.status === "verified" ? alternative.result.output : [])).toEqual(alternativeBefore);
  });

  it("synchronizes an externally selected alternative without remounting", () => {
    const test = harness();
    const alternatives = [alternative, { ...alternative, branchRevision: "stiffer" }] as const;
    const view = render(
      <FieldViewer
        current={current}
        alternatives={alternatives}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        selectedAlternative="lighter"
        environment={test.environment}
      />,
    );
    let ghosts = renderedMeshes(test).filter((mesh) => mesh.name.startsWith("verified-delta"));
    expect((ghosts.find((mesh) => mesh.name.endsWith("lighter"))?.material as THREE.Material & { opacity: number }).opacity).toBe(0.34);
    expect((ghosts.find((mesh) => mesh.name.endsWith("stiffer"))?.material as THREE.Material & { opacity: number }).opacity).toBe(0.12);

    view.rerender(
      <FieldViewer
        current={current}
        alternatives={alternatives}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        selectedAlternative="stiffer"
        environment={test.environment}
      />,
    );
    ghosts = renderedMeshes(test).filter((mesh) => mesh.name.startsWith("verified-delta"));
    expect((ghosts.find((mesh) => mesh.name.endsWith("stiffer"))?.material as THREE.Material & { opacity: number }).opacity).toBe(0.34);
    expect(test.environment.createRenderer).toHaveBeenCalledTimes(1);
  });

  it("resizes in physical pixels and disposes owned render resources", () => {
    const test = harness({ dpr: 2 });
    const view = render(
      <FieldViewer
        current={current}
        alternatives={[]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        environment={test.environment}
      />,
    );
    test.emitResize({
      devicePixelContentBoxSize: [{ inlineSize: 800, blockSize: 400 }],
      contentRect: { width: 300, height: 150 },
    });
    expect(test.renderer.setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(test.renderer.setSize).toHaveBeenLastCalledWith(400, 200, false);

    view.unmount();
    expect(test.disconnect).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();
  });

  it("keeps rejected outputs out of the scene and explains current-output failures", () => {
    const test = harness();
    const failed: ViewerBranch = {
      ...alternative,
      branchRevision: "failed-branch",
      result: { status: "failed", code: "device-error", message: "GPU lost", elapsedMs: 2 },
    };
    render(
      <FieldViewer
        current={{ ...current, result: failed.result }}
        alternatives={[]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        grid={grid}
        assemblyParts={[part]}
        environment={test.environment}
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(/gpu lost.*unverified field is hidden/i);
    expect(renderedMeshes(test)).toHaveLength(0);
    expect(renderedScene(test).getObjectByName("assembly-part:motor-envelope")).toBeDefined();
  });
});
