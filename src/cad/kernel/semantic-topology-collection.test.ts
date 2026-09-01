import { OcctKernel, type ShapeHandle } from "occt-wasm";
import { describe, expect, it } from "vitest";

import { collectTopology } from "./semantic-topology-collection";

const handle = (id: string) => ({ id }) as unknown as ShapeHandle;

describe("exact semantic surface evidence", () => {
  it("does not demand axial surface evaluation for non-axial exact faces", () => {
    const shape = handle("body"), sphere = handle("sphere");
    const kernel = {
      getSubShapes: (_shape: ShapeHandle, kind: string) => kind === "face" ? [sphere] : [],
      surfaceType: () => "sphere",
      getSurfaceCenterOfMass: () => ({ x: 1, y: 2, z: 3 }),
      getSurfaceArea: () => 4,
      adjacentFaces: () => [], edgeToFaceMap: () => [], hashCode: () => 1,
      uvFromPoint: () => { throw new Error("non-axial face evidence must not be evaluated"); },
    } as unknown as OcctKernel;

    expect(collectTopology(kernel, shape, "feature").faces[0]).toMatchObject({
      signature: { geometry: "sphere", centroidM: [1, 2, 3] },
    });
    expect(collectTopology(kernel, shape, "feature").faces[0]?.surfaceEvidence).toBeUndefined();
  });

  it("records normalized plane normals and cylindrical axes while face handles are live", () => {
    const shape = handle("body"), plane = handle("plane"), cylinder = handle("cylinder");
    const kernel = {
      getSubShapes: (_shape: ShapeHandle, kind: string) => kind === "face" ? [plane, cylinder] : [],
      surfaceType: (face: ShapeHandle) => face === plane ? "plane" : "cylinder",
      getSurfaceCenterOfMass: () => ({ x: 0, y: 0, z: 1 }),
      getSurfaceArea: () => 1,
      adjacentFaces: () => [], edgeToFaceMap: () => [], hashCode: (face: ShapeHandle) => face === plane ? 1 : 2,
      uvFromPoint: () => ({ u: 0, v: 1 }),
      surfaceNormal: (face: ShapeHandle) => face === plane ? { x: -0, y: 0, z: 4 } : { x: 2, y: 0, z: 0 },
      uvBounds: () => ({ uMin: 0, uMax: Math.PI * 2, vMin: 0, vMax: 2 }),
      pointOnSurface: (_face: ShapeHandle, u: number, v: number) => ({ x: u >= Math.PI ? -2 : 2, y: 0, z: v }),
      getFaceCylinderData: () => ({ radius: 2, isDirect: true }),
    } as unknown as OcctKernel;

    const topology = collectTopology(kernel, shape, "feature");
    expect(topology.faces[0]?.surfaceEvidence).toEqual({ kind: "plane", normal: [0, 0, 1] });
    expect(topology.faces[1]?.surfaceEvidence).toEqual({
      kind: "cylinder", axis: [0, 0, 1], originM: [0, 0, 1], radiusM: 2,
    });
    const numbers = topology.faces.flatMap(({ surfaceEvidence }) => surfaceEvidence?.kind === "plane"
      ? surfaceEvidence.normal : surfaceEvidence?.kind === "cylinder"
        ? [...surfaceEvidence.axis, ...surfaceEvidence.originM] : []);
    expect(numbers.some((value) => Object.is(value, -0))).toBe(false);
  });

  it("extracts the exact axis and projected anchor from a real OCCT cylinder", async () => {
    const kernel = await OcctKernel.init();
    try {
      const cylinder = kernel.makeCylinder(2, 4);
      const evidence = collectTopology(kernel, cylinder, "feature").faces
        .find(({ surfaceEvidence }) => surfaceEvidence?.kind === "cylinder")?.surfaceEvidence;
      if (!evidence || evidence.kind !== "cylinder") throw new Error("expected cylinder evidence");
      expect(evidence.axis).toEqual([0, 0, 1]);
      expect(evidence.originM[0]).toBeCloseTo(0, 12);
      expect(evidence.originM[1]).toBeCloseTo(0, 12);
      expect(evidence.originM[2]).toBeCloseTo(2, 12);
      expect(evidence.radiusM).toBeCloseTo(2, 12);
      kernel.release(cylinder);
    } finally {
      kernel[Symbol.dispose]();
    }
  });
});
