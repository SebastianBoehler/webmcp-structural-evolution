import { describe, expect, it } from "vitest";

import { inspectAssemblyConflicts } from "../../assembly/assembly-conflicts";
import { evaluateInventory } from "../../domain/design";
import { SE6_CATALOG } from "./cobot-catalog";
import {
  SE6_INSTANCE_GROUPS,
  SE6_INVENTORY,
  se6Assembly,
} from "./cobot-assembly";

const millimetres = (value: { readonly value: number; readonly unit: "m" | "mm" }) =>
  value.unit === "m" ? value.value * 1_000 : value.value;
const centerOf = (id: string) => {
  const instance = se6Assembly.components.find(({ instanceId }) => instanceId === id);
  if (!instance) throw new Error(`Missing SE-6 instance: ${id}`);
  const { position } = instance.transform;
  return [millimetres(position.x), millimetres(position.y), millimetres(position.z)];
};

describe("SE-6 assembly", () => {
  it("authors exactly 52 owned semantic instances across the seven robot groups", () => {
    expect(se6Assembly.components).toHaveLength(52);
    expect(Object.keys(SE6_INSTANCE_GROUPS)).toEqual([
      "base", "shoulder", "upperArm", "forearm", "wrist", "tooling", "services",
    ]);
    expect(Object.values(SE6_INSTANCE_GROUPS).flat()).toHaveLength(52);
    expect(new Set(Object.values(SE6_INSTANCE_GROUPS).flat()).size).toBe(52);
    expect(new Set(se6Assembly.components.map(({ instanceId }) => instanceId))).toEqual(
      new Set(Object.values(SE6_INSTANCE_GROUPS).flat()),
    );
  });

  it("places six distinct joint axes and a mounted distal tool chain", () => {
    expect(centerOf("j1-turntable")).toEqual([0, 0, 268]);
    expect(centerOf("j2-barrel")).toEqual([0, 0, 340]);
    expect(centerOf("j3-barrel")).toEqual([420, 0, 340]);
    expect(centerOf("j4-roll-housing")).toEqual([650, 0, 520]);
    expect(centerOf("j5-pitch-housing")).toEqual([720, 0, 520]);
    expect(centerOf("j6-tool-roll")).toEqual([790, 0, 520]);
    expect(centerOf("calibration-payload")[0]).toBeGreaterThan(centerOf("gripper-body")[0]!);
  });

  it("leaves the load-bearing upper arm to the topology design domain", () => {
    expect(se6Assembly.components.some(({ instanceId }) => instanceId === "upper-arm-link")).toBe(false);
    expect(centerOf("upper-arm-service-cover")[1]).toBeLessThan(-65);
  });

  it("is buildable from its declared inventory without unresolved conflicts", () => {
    expect(evaluateInventory(SE6_INVENTORY, se6Assembly).status).toBe("buildable");
    expect(inspectAssemblyConflicts(se6Assembly, SE6_CATALOG, SE6_INVENTORY)).toEqual([]);
  });

  it("records qualified assumptions on every original component class", () => {
    expect(SE6_CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(SE6_CATALOG.every(({ manufacturer }) => manufacturer === "Sunderlabs")).toBe(true);
    expect(SE6_CATALOG.every(({ provenance }) =>
      provenance.uncertainty.some(({ statement }) => statement.includes("Qualified SE-6 design assumption")),
    )).toBe(true);
  });
});
