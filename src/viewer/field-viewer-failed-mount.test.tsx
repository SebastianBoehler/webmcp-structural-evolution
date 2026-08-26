import { cleanup, render, screen } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FieldViewer } from "./FieldViewer";
import {
  alternative,
  current,
  harness,
  region,
} from "./field-viewer-test-support";

describe("FieldViewer failed mount cleanup", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reports the mount error and retries its retained cleanup session on unmount", () => {
    vi.spyOn(THREE.InstancedMesh.prototype, "setMatrixAt").mockImplementationOnce(() => {
      throw new Error("mesh construction failed");
    });
    const meshDispose = vi.spyOn(THREE.InstancedMesh.prototype, "dispose");
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    materialDispose.mockImplementationOnce(() => {
      throw new Error("material cleanup failed once");
    });
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

    expect(screen.getByRole("alert").textContent).toMatch(/mesh construction failed/i);
    const initialMaterialDisposals = materialDispose.mock.calls.length;
    const initialGeometryDisposals = geometryDispose.mock.calls.length;
    expect(initialMaterialDisposals).toBeGreaterThanOrEqual(1);
    expect(meshDispose).not.toHaveBeenCalled();
    expect(initialGeometryDisposals).toBeGreaterThanOrEqual(1);
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();

    view.unmount();
    expect(materialDispose).toHaveBeenCalledTimes(initialMaterialDisposals + 1);
    expect(meshDispose).not.toHaveBeenCalled();
    expect(geometryDispose).toHaveBeenCalledTimes(initialGeometryDisposals);
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();
  });
});
