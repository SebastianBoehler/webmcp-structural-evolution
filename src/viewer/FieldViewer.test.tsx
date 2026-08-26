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

describe("FieldViewer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the canvas paired with semantic controls, selection, and branch deltas", () => {
    const test = harness();
    const onModeChange = vi.fn();
    const onAlternativeSelect = vi.fn();

    render(
      <FieldViewer
        current={current}
        alternatives={[alternative]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        environment={test.environment}
        onModeChange={onModeChange}
        onAlternativeSelect={onAlternativeSelect}
      />,
    );

    expect(screen.getByRole("img", { name: /3d voxel field comparison/i })).toBeVisible();
    expect(screen.getByText(/arm rib.*x 0–2.*y 0–2.*z 0–1/i)).toBeVisible();
    expect(screen.getByRole("group", { name: /comparison mode/i })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: /parent/i })).toBeVisible();
    expect(screen.getAllByRole("cell", { name: "accepted" })).toHaveLength(2);
    expect(screen.getByRole("cell", { name: /1 added/i })).toBeVisible();
    expect(screen.getByRole("cell", { name: /1 removed/i })).toBeVisible();
    expect(test.controls.target.set).toHaveBeenCalledWith(5, 7, 11);

    fireEvent.click(screen.getByRole("radio", { name: /peel/i }));
    fireEvent.click(screen.getByRole("button", { name: /select lighter/i }));
    expect(onModeChange).toHaveBeenCalledWith("peel");
    expect(onAlternativeSelect).toHaveBeenCalledWith("lighter");
  });

  it("renders one solid mesh plus one ghost mesh per compatible alternative", () => {
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
  });

  it("auditions one exact alternative as the sole solid mesh without mutating either field", () => {
    const test = harness();
    const currentBefore = Array.from(current.result.status === "verified" ? current.result.output : []);
    const alternativeBefore = Array.from(
      alternative.result.status === "verified" ? alternative.result.output : [],
    );

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

    const meshes = renderedMeshes(test);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]?.count).toBe(3);
    expect(Array.from(current.result.status === "verified" ? current.result.output : [])).toEqual(
      currentBefore,
    );
    expect(
      Array.from(alternative.result.status === "verified" ? alternative.result.output : []),
    ).toEqual(alternativeBefore);
  });

  it("highlights only the focused branch and synchronizes an externally selected branch", () => {
    const test = harness();
    const stiffer = { ...alternative, branchRevision: "stiffer" };
    const view = render(
      <FieldViewer
        current={current}
        alternatives={[alternative, stiffer]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        environment={test.environment}
      />,
    );

    fireEvent.focus(screen.getByRole("button", { name: /select lighter/i }));
    let ghosts = renderedMeshes(test).filter((mesh) => mesh.name.startsWith("verified-delta"));
    expect((ghosts.find((mesh) => mesh.name.endsWith("lighter"))?.material as THREE.Material & { opacity: number }).opacity).toBe(0.34);
    expect((ghosts.find((mesh) => mesh.name.endsWith("stiffer"))?.material as THREE.Material & { opacity: number }).opacity).toBe(0.12);

    view.rerender(
      <FieldViewer
        current={current}
        alternatives={[alternative, stiffer]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        selectedAlternative="stiffer"
        environment={test.environment}
      />,
    );
    ghosts = renderedMeshes(test).filter((mesh) => mesh.name.startsWith("verified-delta"));
    expect((ghosts.find((mesh) => mesh.name.endsWith("stiffer"))?.material as THREE.Material & { opacity: number }).opacity).toBe(0.34);
    expect((ghosts.find((mesh) => mesh.name.endsWith("lighter"))?.material as THREE.Material & { opacity: number }).opacity).toBe(0.12);
  });

  it("uses device-pixel resize data and the DPR fallback without creating frame-loop observers", () => {
    const test = harness();
    render(
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

    test.emitResize({ contentRect: { width: 320, height: 180 } });
    expect(test.renderer.setSize).toHaveBeenLastCalledWith(320, 180, false);
    test.flushFrame();
    expect(test.environment.createResizeObserver).toHaveBeenCalledTimes(1);
    expect(test.renderer.render).toHaveBeenCalled();
  });

  it("disconnects observers, cancels RAF, and disposes every owned render resource", () => {
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    const meshDispose = vi.spyOn(THREE.InstancedMesh.prototype, "dispose");
    const test = harness();

    const view = render(
      <FieldViewer
        current={current}
        alternatives={[alternative]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        environment={test.environment}
      />,
    );
    view.unmount();

    expect(test.disconnect).toHaveBeenCalledOnce();
    expect(test.cancelFrame).toHaveBeenCalledWith(7);
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();
    expect(meshDispose).toHaveBeenCalledTimes(2);
    expect(geometryDispose).toHaveBeenCalledTimes(2);
    expect(materialDispose).toHaveBeenCalledTimes(2);
  });

  it("keeps unverified and incompatible outputs visible in DOM but out of the scene", () => {
    const test = harness();
    const failed: ViewerBranch = {
      ...alternative,
      branchRevision: "failed-branch",
      result: { status: "failed", code: "device-error", message: "GPU lost", elapsedMs: 2 },
    };
    const incompatible: ViewerBranch = {
      ...alternative,
      branchRevision: "shifted-branch",
      grid: { ...grid, anchor: { ...grid.anchor, position: [9, 7, 11] } },
    };

    render(
      <FieldViewer
        current={current}
        alternatives={[failed, incompatible]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        environment={test.environment}
      />,
    );

    expect(renderedMeshes(test)).toHaveLength(1);
    expect(screen.getByRole("cell", { name: /failed.*gpu lost.*not rendered/i })).toBeVisible();
    expect(screen.getByRole("cell", { name: /incompatible.*not rendered/i })).toBeVisible();
  });

  it("shows loading and current-output failures instead of fabricating a field", () => {
    const test = harness();
    const { rerender } = render(
      <FieldViewer
        current={null}
        alternatives={[]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        environment={test.environment}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/waiting for verified compute/i);

    rerender(
      <FieldViewer
        current={{
          ...current,
          result: {
            status: "mismatch",
            code: "verification-mismatch",
            message: "verification mismatch",
            elapsedMs: 2,
            relativeL2: 1,
            tolerance: 0.000005,
          },
        }}
        alternatives={[]}
        selectedRegion={region}
        threshold={0.5}
        mode="overlay"
        environment={test.environment}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/verification mismatch.*not rendered/i);
  });
});
