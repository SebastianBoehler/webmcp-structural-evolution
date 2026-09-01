import { describe, expect, it } from "vitest";
import { createResultLayers } from "./result-layers";

describe("result layers", () => {
  it("keeps typed topology, structural, thermal, and mechanism layers independently controlled", () => {
    const layers = createResultLayers();
    const grid = { dimensions: [2, 1, 1] as const, cellSize: [10, 10, 10] as const,
      origin: [0, 0, 0] as const, active: new Uint8Array([1, 1]) };
    layers.set("topology", { density: new Float32Array([.2, .8]), ...grid });
    layers.set("displacement", { values: new Float32Array([.01, .02]), maximum: .02,
      vectors: new Float32Array([-.01, 0, 0, .02, 0, 0]), displacementUnit: "mm", ...grid });
    layers.set("stress", { values: new Float32Array([12, 8]), maximum: 12, ...grid });
    layers.set("temperature", { values: new Float32Array([320, 330]), maximum: 330, ...grid });
    layers.set("flux", { values: new Float32Array([4, 2]), maximum: 4,
      vectors: new Float32Array([-4, 0, 0, 2, 0, 0]), vectorUnit: "W/m^2", ...grid });
    layers.set("mechanism", { componentId: "component:arm", transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 2, 1, 1] });

    expect(layers.visible()).toEqual(["topology", "displacement", "stress", "temperature", "flux", "mechanism"]);
    layers.set("stress", undefined);
    expect(layers.snapshot()).toMatchObject({
      topology: { density: expect.any(Float32Array) },
      temperature: { maximum: 330 },
      mechanism: { componentId: "component:arm" },
    });
    expect(layers.visible()).not.toContain("stress");
  });

  it.each([
    ["missing displacement vectors", "displacement", { displacementUnit: "mm" }],
    ["unknown displacement unit", "displacement", { vectors: new Float32Array(6), displacementUnit: "m" }],
    ["short displacement vectors", "displacement", { vectors: new Float32Array(5), displacementUnit: "mm" }],
    ["nonfinite displacement vectors", "displacement", { vectors: new Float32Array([0, 0, 0, 0, 0, NaN]), displacementUnit: "mm" }],
    ["missing flux vectors", "flux", { vectorUnit: "W/m^2" }],
    ["unknown flux unit", "flux", { vectors: new Float32Array(6), vectorUnit: "N" }],
    ["short flux vectors", "flux", { vectors: new Float32Array(5), vectorUnit: "W/m^2" }],
  ] as const)("rejects %s", (_name, layer, vectorFields) => {
    const layers = createResultLayers();
    expect(() => layers.set(layer, { dimensions: [2, 1, 1], cellSize: [1, 1, 1],
      origin: [0, 0, 0], active: new Uint8Array([1, 1]), values: new Float32Array([1, 2]),
      maximum: 2, ...vectorFields } as never)).toThrow();
  });

  it.each([
    ["dimensions", { dimensions: [0, 1, 1] }],
    ["cell size", { cellSize: [1, 0, 1] }],
    ["origin", { origin: [0, NaN, 0] }],
    ["active length", { active: new Uint8Array(1) }],
    ["scalar length", { values: new Float32Array(1) }],
    ["finite scalar", { values: new Float32Array([1, NaN]) }],
    ["positive maximum", { maximum: 0 }],
  ] as const)("rejects invalid %s before sampling", (_name, mutation) => {
    const layers = createResultLayers();
    expect(() => layers.set("temperature", { dimensions: [2, 1, 1], cellSize: [1, 1, 1],
      origin: [0, 0, 0], active: new Uint8Array([1, 1]), values: new Float32Array([1, 2]),
      maximum: 2, ...mutation } as never)).toThrow();
  });

  it("applies the same shape and finiteness checks to topology density", () => {
    const layers = createResultLayers();
    expect(() => layers.set("topology", { dimensions: [2, 1, 1], cellSize: [1, 1, 1],
      origin: [0, 0, 0], active: new Uint8Array([1, 1]),
      density: new Float32Array([.2, NaN]) })).toThrow("finite");
  });
});
