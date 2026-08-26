import { describe, expect, it, vi } from "vitest";

import { decodeStepBytes } from "./step-import";

const cube = {
  success: true,
  meshes: [{
    name: "FCU enclosure",
    color: [0.22, 0.31, 0.42],
    attributes: {
      position: { array: [-27.15, -19.5, 0, 27.15, -19.5, 0, 27.15, 19.5, 17.5, -27.15, 19.5, 17.5] },
      normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] },
    },
    index: { array: [0, 1, 2, 0, 2, 3] },
  }],
};

describe("decodeStepBytes", () => {
  it("tessellates STEP into bounded millimetre mesh data", async () => {
    const read = vi.fn(() => cube);

    const mesh = await decodeStepBytes(new Uint8Array([1, 2, 3]), async () => ({ ReadStepFile: read }));

    expect(read).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({ linearUnit: "millimeter" }));
    expect(mesh.surfaces).toHaveLength(1);
    expect(mesh.surfaces[0]?.positions).toBeInstanceOf(Float32Array);
    expect(mesh.surfaces[0]?.indices).toBeInstanceOf(Uint32Array);
    expect(mesh.sizeMm[0]).toBeCloseTo(54.3);
    expect(mesh.sizeMm.slice(1)).toEqual([39, 17.5]);
    expect(mesh.triangleCount).toBe(2);
  });

  it("rejects malformed tessellation without creating partial geometry", async () => {
    await expect(decodeStepBytes(new Uint8Array([1]), async () => ({
      ReadStepFile: () => ({ ...cube, meshes: [{ ...cube.meshes[0], index: { array: [0, 8, 2] } }] }),
    }))).rejects.toThrow(/invalid step mesh/i);
  });

  it("rejects importer failures and empty models", async () => {
    await expect(decodeStepBytes(new Uint8Array([1]), async () => ({
      ReadStepFile: () => ({ success: false, meshes: [] }),
    }))).rejects.toThrow(/could not be tessellated/i);
  });
});
