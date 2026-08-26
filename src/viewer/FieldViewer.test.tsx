import { cleanup, render, screen } from "@testing-library/react";
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

const part: AssemblyVisualPart = {
  id: "motor-envelope",
  selectionId: "motor",
  label: "Motor",
  appearance: "component",
  kind: "cylinder",
  center: [8, 0, 2],
  radius: 2,
  height: 4,
};

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

    expect(screen.getByRole("img", { name: /interactive 3d drone-arm assembly/i })).toBeVisible();
    expect(screen.getByText(/drag empty space to orbit.*drag a motor to move.*scroll to zoom/i)).toBeVisible();
    expect(screen.getByRole("status").textContent).toMatch(/assembly ready/i);
    const motor = renderedScene(test).getObjectByName("assembly-part:motor-envelope") as THREE.Mesh;
    expect(motor).toBeDefined();
    expect((motor.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.9);
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
