import { OcctKernel } from "occt-wasm";
import { describe, expect, it } from "vitest";

import { exportStepBytes, importStepBytes } from "./step-exchange";

describe("STEP exchange", () => {
  it("round trips an 80 x 40 x 10 mm solid without changing SI mass geometry", async () => {
    using kernel = await OcctKernel.init();
    const source = kernel.makeBox(0.08, 0.04, 0.01);

    try {
      const step = exportStepBytes(kernel, source);
      const imported = importStepBytes(kernel, step);
      try {
        const text = new TextDecoder().decode(step);
        expect(text).toContain("ISO-10303-21");
        expect(text).toContain("SI_UNIT(.MILLI.,.METRE.)");
        expect(kernel.isValid(imported)).toBe(true);
        expect(kernel.getVolume(imported)).toBeCloseTo(0.000032, 12);
        expect(kernel.getBoundingBox(imported)).toMatchObject({
          xmin: expect.closeTo(0, 9), ymin: expect.closeTo(0, 9), zmin: expect.closeTo(0, 9),
          xmax: expect.closeTo(0.08, 9), ymax: expect.closeTo(0.04, 9), zmax: expect.closeTo(0.01, 9),
        });
      } finally {
        kernel.release(imported);
      }
    } finally {
      kernel.release(source);
    }

    expect(kernel.shapeCount).toBe(0);
  });

  it("rejects an imported shell without leaking the rejected shape", async () => {
    using kernel = await OcctKernel.init();
    const face = kernel.buildTriFace(
      { x: 0, y: 0, z: 0 },
      { x: 0.01, y: 0, z: 0 },
      { x: 0, y: 0.01, z: 0 },
    );
    try {
      const step = exportStepBytes(kernel, face);
      const beforeImport = kernel.shapeCount;
      let imported: ReturnType<typeof importStepBytes> | undefined;
      let failure: unknown;
      try {
        imported = importStepBytes(kernel, step);
      } catch (error) {
        failure = error;
      } finally {
        if (imported) kernel.release(imported);
      }

      expect(failure).toMatchObject({
        name: "CadRebuildError",
        code: "invalid-solid",
      });
      expect(kernel.shapeCount).toBe(beforeImport);
    } finally {
      kernel.release(face);
    }
    expect(kernel.shapeCount).toBe(0);
  });

  it("maps malformed STEP data to a typed invalid-solid failure", async () => {
    using kernel = await OcctKernel.init();
    const beforeImport = kernel.shapeCount;
    let failure: unknown;

    try {
      importStepBytes(kernel, new TextEncoder().encode("not a STEP exchange"));
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: "CadRebuildError",
      code: "invalid-solid",
    });
    expect(kernel.shapeCount).toBe(beforeImport);
  });
});
