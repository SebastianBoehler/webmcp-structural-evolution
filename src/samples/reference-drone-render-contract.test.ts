import { describe, expect, it } from "vitest";

import { compileParametricGeometry } from "../assembly/parametric-geometry";
import { REFERENCE_DRONE_CATALOG } from "./reference-drone-catalog";
import {
  componentGeometryEnvelope,
  fastenerRenderContract,
  motorRenderContract,
} from "./reference-drone-render-contract";

const component = (id: string) => {
  const result = REFERENCE_DRONE_CATALOG.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`missing ${id}`);
  return result;
};

describe("reference drone render contract", () => {
  it("exposes a positive geometry envelope for every used dimension set", () => {
    const envelopes = REFERENCE_DRONE_CATALOG.map((item) => ({
      id: item.id,
      envelope: componentGeometryEnvelope(item),
    }));

    expect(envelopes.every(({ envelope }) => envelope.maximum.every((maximum, axis) =>
      maximum > envelope.minimum[axis]!))).toBe(true);
    expect(envelopes.find(({ id }) => id === "propeller-5x4.3x3")?.envelope).toEqual({
      minimum: [-0.0635, -0.0635, -0.00325],
      maximum: [0.0635, 0.0635, 0.00325],
    });
  });

  it("derives every detailed motor feature from the specification graph", async () => {
    const motor = component("motor-2207");
    const contract = motorRenderContract(motor);

    expect(contract).toMatchObject({
      base: { radius: 0.012, height: 0.003, centerZ: 0.0015 },
      stator: { radius: 0.01125, height: 0.0076, centerZ: 0.0067 },
      bell: { radius: 0.014, height: 0.017, centerZ: 0.0114 },
      shaft: { radius: 0.0025, height: 0.0121, centerZ: 0.02585 },
      localBounds: { minimum: [-0.014, -0.014, 0], maximum: [0.014, 0.014, 0.0319] },
    });
    expect(contract.mountHoles).toHaveLength(4);
    expect(contract.mountHoles.every(({ radius }) => radius === 0.0015)).toBe(true);

    if (motor.geometry.kind !== "parametric") throw new Error("motor graph missing");
    const mesh = await compileParametricGeometry(motor.geometry.graph);
    expect(mesh.sizeMm).toEqual(contract.localBounds.maximum.map((maximum, axis) =>
      (maximum - contract.localBounds.minimum[axis]!) * 1_000));
  });

  it("derives and compiles the fastener around its under-head anchor", async () => {
    const fastener = component("fastener-m3x8");
    const contract = fastenerRenderContract(fastener);

    expect(contract).toMatchObject({
      shank: { radius: 0.0015, height: 0.008, centerZ: 0.004 },
      head: { radius: 0.00284 },
      localBounds: { minimum: [-0.00284, -0.00284, -0.003], maximum: [0.00284, 0.00284, 0.008] },
    });
    if (fastener.geometry.kind !== "parametric") throw new Error("fastener graph missing");
    await expect(compileParametricGeometry(fastener.geometry.graph)).resolves.toMatchObject({
      sizeMm: [5.68, 5.68, 11],
    });
  });
});
