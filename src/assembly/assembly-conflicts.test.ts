import { describe, expect, it } from "vitest";

import { defineAssemblyDraft } from "../domain/assembly-model";
import { defineInventory } from "../domain/design";
import { REFERENCE_DRONE_CATALOG, referenceComponent } from "../samples/reference-drone-catalog";
import { inspectAssemblyConflicts } from "./assembly-conflicts";

const m = (value: number) => ({ value, unit: "m" as const });
const rad = (value: number) => ({ value, unit: "rad" as const });
const point = (x: number, y: number, z: number) => ({ x: m(x), y: m(y), z: m(z) });
const orientation = { roll: rad(0), pitch: rad(0), yaw: rad(0) };
const transform = (x: number, y: number, z: number, rotation = orientation) => ({ position: point(x, y, z), orientation: rotation });
const box = (id: string, size: readonly [number, number, number]) => ({
  kind: "box" as const, id, center: point(0, 0, 0), size: point(...size), orientation,
});

describe("assembly conflicts", () => {
  it("reports collision, missing stock, and inaccessible hardware separately", async () => {
    const motor = referenceComponent("motor-2207");
    const collidingDraft = await defineAssemblyDraft({
      id: "colliding-motors", geometryCoordinates: "assembly",
      components: [
        { instanceId: "motor-a", componentRevision: motor.revision, quantity: 1, transform: transform(0, 0, 0) },
        { instanceId: "motor-b", componentRevision: motor.revision, quantity: 1, transform: transform(0, 0, 0) },
      ],
      targetEnvelope: box("target", [0.24, 0.24, 0.024]), preservedMounts: [], obstacleVolumes: [],
      accessVolumes: [box("motor-a-service-access", [0.03, 0.03, 0.03])],
      missingComponents: [], incompatibleComponents: [], ambiguousComponents: [],
    });
    const inventory = defineInventory([
      { componentRevision: motor.revision, ownedQuantity: 1, availability: "available", label: "Bench motor" },
    ]);

    expect(inspectAssemblyConflicts(collidingDraft, REFERENCE_DRONE_CATALOG, inventory).map(({ kind }) => kind))
      .toEqual(["collision", "insufficient-stock", "tool-access"]);
  });

  it("sorts same-kind collisions by their stable instance identifiers", async () => {
    const motor = referenceComponent("motor-2207");
    const draft = await defineAssemblyDraft({
      id: "ordered-collisions", geometryCoordinates: "assembly",
      components: ["c", "a", "b"].map((instanceId) => ({
        instanceId, componentRevision: motor.revision, quantity: 1, transform: transform(0, 0, 0),
      })),
      targetEnvelope: box("target", [0.24, 0.24, 0.024]), preservedMounts: [], obstacleVolumes: [], accessVolumes: [],
      missingComponents: [], incompatibleComponents: [], ambiguousComponents: [],
    });
    const inventory = defineInventory([{ componentRevision: motor.revision, ownedQuantity: 3, availability: "available" }]);

    expect(inspectAssemblyConflicts(draft, REFERENCE_DRONE_CATALOG, inventory)
      .filter(({ kind }) => kind === "collision").map(({ id }) => id)).toEqual([
      "collision:a:b", "collision:a:c", "collision:b:c",
    ]);
  });

  it("reports each canonical component revision absent from the catalog", async () => {
    const motor = referenceComponent("motor-2207");
    const draft = await defineAssemblyDraft({
      id: "unknown-catalog-revision", geometryCoordinates: "assembly",
      components: [{ instanceId: "unknown-motor", componentRevision: motor.revision, quantity: 1, transform: transform(0, 0, 0) }],
      targetEnvelope: box("target", [0.24, 0.24, 0.024]), preservedMounts: [], obstacleVolumes: [], accessVolumes: [],
      missingComponents: [], incompatibleComponents: [], ambiguousComponents: [],
    });
    const inventory = defineInventory([{ componentRevision: motor.revision, ownedQuantity: 1, availability: "available" }]);

    expect(inspectAssemblyConflicts(draft, [], inventory)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "missing-component", instanceIds: ["unknown-motor"] }),
    ]));
  });

  it("detects a collision introduced by a pitched canonical box", async () => {
    const body = referenceComponent("body-interface");
    const draft = await defineAssemblyDraft({
      id: "pitched-body-collision", geometryCoordinates: "assembly",
      components: [
        { instanceId: "pitched", componentRevision: body.revision, quantity: 1, transform: transform(0, 0, 0, { roll: rad(0), pitch: rad(Math.PI / 2), yaw: rad(0) }) },
        { instanceId: "level", componentRevision: body.revision, quantity: 1, transform: transform(0, 0, 0.012) },
      ],
      targetEnvelope: box("target", [0.24, 0.24, 0.024]), preservedMounts: [], obstacleVolumes: [], accessVolumes: [],
      missingComponents: [], incompatibleComponents: [], ambiguousComponents: [],
    });
    const inventory = defineInventory([{ componentRevision: body.revision, ownedQuantity: 2, availability: "available" }]);

    expect(inspectAssemblyConflicts(draft, [body], inventory).filter(({ kind }) => kind === "collision"))
      .toHaveLength(1);
  });
});
