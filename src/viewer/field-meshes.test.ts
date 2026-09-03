import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createFieldMeshes,
  restoreAnalysisSurfaceField,
  updateAnalysisSurfaceField,
} from "./field-meshes";
import type { VoxelGrid } from "./field-instances";

describe("analysis field meshes", () => {
  it("uses visible fixed-color bands for the minimum and maximum values", () => {
    const grid: VoxelGrid = {
      dimensions: { width: 2, height: 1, depth: 1 },
      cellSize: [1, 1, 1],
      anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    };
    const releases: Array<() => void> = [];
    const result = createFieldMeshes(
      grid,
      new Uint32Array([0, 1]),
      [],
      { own: (release) => { releases.push(release); return { relinquish() {} }; }, attach() {} },
      undefined,
      { kind: "stress", values: new Float32Array([0, 10]), maximum: 10 },
    );
    expect(result.meshes).toHaveLength(2);
    expect((result.meshes[0]!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x16b9ff);
    expect((result.meshes[1]!.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xff2d55);
    releases.reverse().forEach((release) => release());
  });

  it("restores the envelope colors after a replay case stops", () => {
    const grid: VoxelGrid = {
      dimensions: { width: 2, height: 1, depth: 1 },
      cellSize: [1, 1, 1],
      anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    };
    const releases: Array<() => void> = [];
    const result = createFieldMeshes(
      grid,
      new Uint32Array([0, 1]),
      [],
      { own: (release) => { releases.push(release); return { relinquish() {} }; }, attach() {} },
      new Float32Array([1, 0]),
      { kind: "stress", values: new Float32Array([0, 10]), maximum: 10 },
    );
    const geometry = result.analysisSurfaces[0]!.geometry;
    const envelopeColors = Array.from(geometry.getAttribute("color").array);

    updateAnalysisSurfaceField(result.analysisSurfaces, new Float32Array([10, 0]), 10, 1);
    expect(Array.from(geometry.getAttribute("color").array)).not.toEqual(envelopeColors);

    restoreAnalysisSurfaceField(result.analysisSurfaces);
    expect(Array.from(geometry.getAttribute("color").array)).toEqual(envelopeColors);
    releases.reverse().forEach((release) => release());
  });
});
