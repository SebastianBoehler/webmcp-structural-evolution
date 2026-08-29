import type { ComponentDefinition } from "../../domain/component-model";

export const mm = (value: number) => ({ value, unit: "mm" as const });
export const kg = (value: number) => ({ value, unit: "kg" as const });
export const rad = (value: number) => ({ value, unit: "rad" as const });
export const mmPoint = (x: number, y: number, z: number) => ({ x: mm(x), y: mm(y), z: mm(z) });
export const orientationRad = (roll = 0, pitch = 0, yaw = 0) => ({
  roll: rad(roll), pitch: rad(pitch), yaw: rad(yaw),
});
export const transformMm = (
  x: number, y: number, z: number,
  [roll, pitch, yaw]: readonly [number, number, number] = [0, 0, 0],
) => ({ position: mmPoint(x, y, z), orientation: orientationRad(roll, pitch, yaw) });

export const boxVolumeMm = (
  id: string,
  size: readonly [number, number, number],
  center: readonly [number, number, number] = [0, 0, 0],
) => ({
  kind: "box" as const, id, center: mmPoint(...center), size: mmPoint(...size),
  orientation: orientationRad(),
});

export const cylinderVolumeMm = (
  id: string,
  radius: number,
  height: number,
  center: readonly [number, number, number] = [0, 0, 0],
) => ({
  kind: "cylinder" as const, id, center: mmPoint(...center), radius: mm(radius), height: mm(height),
  orientation: orientationRad(),
});

export function qualifiedProvenance(
  title: string,
  property: string,
  value: number,
  unit: string,
): ComponentDefinition["provenance"] {
  return {
    mode: "user-defined",
    licence: { status: "redistributable", reference: "sunderlabs:se6-fixture:rev-1" },
    uncertainty: [{
      property,
      statement: "Qualified SE-6 design assumption; verify against selected hardware and material test data.",
    }],
    sources: [{
      id: "se6-design-spec", classification: "engineering-drawing",
      title, reference: "sunderlabs:se6-fixture:rev-1",
      sourceTimestamp: "2026-08-29", accessedOn: "2026-08-29", redistribution: "redistributable",
    }],
    sourceObservations: [{ property, value, unit, sourceId: "se6-design-spec" }],
  };
}
