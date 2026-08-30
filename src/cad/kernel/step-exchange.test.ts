import { OcctKernel } from "occt-wasm";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { exportStepBytes, importStepBytes } from "./step-exchange";

describe("STEP exchange", () => {
  it("imports an independently authored Siemens NX 8 AP214 solid", async () => {
    using kernel = await OcctKernel.init();
    const bytes = new Uint8Array(await readFile(
      resolve(process.cwd(), "src/cad/kernel/fixtures/nx8-basic-cube.stp"),
    ));
    const imported = importStepBytes(kernel, bytes);
    try {
      expect(kernel.isValid(imported)).toBe(true);
      expect(kernel.subShapeCount(imported, "solid")).toBe(1);
      expect(kernel.getVolume(imported)).toBeCloseTo(0.027, 10);
      expect(kernel.getBoundingBox(imported)).toMatchObject({
        xmin: expect.closeTo(-0.16, 9), ymin: expect.closeTo(-0.14, 9), zmin: expect.closeTo(0, 9),
        xmax: expect.closeTo(0.14, 9), ymax: expect.closeTo(0.16, 9), zmax: expect.closeTo(0.3, 9),
      });
    } finally {
      kernel.release(imported);
    }
    expect(kernel.shapeCount).toBe(0);
  });

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

  it("rejects STEP containing multiple exact solids without leaking handles", async () => {
    using kernel = await OcctKernel.init();
    const first = kernel.makeBox(0.01, 0.01, 0.01);
    const secondAtOrigin = kernel.makeBox(0.01, 0.01, 0.01);
    const second = kernel.translate(secondAtOrigin, 0.02, 0, 0);
    const compound = kernel.makeCompound([first, second]);
    try {
      const step = exportStepBytes(kernel, compound);
      const beforeImport = kernel.shapeCount;
      expect(() => importStepBytes(kernel, step)).toThrowError(expect.objectContaining({
        name: "CadRebuildError", code: "invalid-solid",
      }));
      expect(kernel.shapeCount).toBe(beforeImport);
    } finally {
      kernel.release(compound);
      kernel.release(second);
      kernel.release(secondAtOrigin);
      kernel.release(first);
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
