import type { ComponentDefinition } from "../domain/design";
import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import type { AssemblyVisualPart } from "../viewer/render-envelope";

const fixture = DRONE_ARM_FOUNDATION_STUDY;

function millimetres(value: { readonly value: number; readonly unit: string }): number {
  if (value.unit !== "mm") throw new Error("The drone-arm visual requires millimetre geometry");
  return value.value;
}

function centerOf(
  volume: ComponentDefinition["envelope"],
  offset: readonly number[] = [0, 0, 0],
): readonly [number, number, number] {
  return [volume.center.x, volume.center.y, volume.center.z].map(
    (axis, index) => millimetres(axis) + (offset[index] ?? 0),
  ) as [number, number, number];
}

function volumePart(
  volume: ComponentDefinition["envelope"],
  identity: Pick<AssemblyVisualPart, "id" | "selectionId" | "label" | "appearance">,
  offset: readonly number[] = [0, 0, 0],
): AssemblyVisualPart {
  const center = centerOf(volume, offset);
  return volume.kind === "box"
    ? {
        ...identity,
        kind: "box",
        center,
        size: [volume.size.x, volume.size.y, volume.size.z].map(millimetres) as [number, number, number],
      }
    : {
        ...identity,
        kind: "cylinder",
        center,
        radius: millimetres(volume.radius),
        height: millimetres(volume.height),
      };
}

function componentOffset(component: ComponentDefinition): readonly [number, number, number] {
  const requirement = fixture.assembly.components.find(
    (candidate) => candidate.componentRevision === component.revision,
  );
  if (!requirement) throw new Error(`Assembly placement missing for ${component.id}`);
  const { position } = requirement.transform;
  return [position.x, position.y, position.z].map(millimetres) as [number, number, number];
}

const componentParts = fixture.components
  .filter((component) => component.category !== "fastener")
  .map((component) => volumePart(component.envelope, {
    id: component.envelope.id,
    selectionId: component.id,
    label: component.id === "motor-2207" ? "Motor" : "Frame interface",
    appearance: "component",
  }, componentOffset(component)));

const fastener = fixture.components.find((component) => component.category === "fastener");
if (!fastener) throw new Error("Fastener component missing from the exact fixture");
const fastenerParts = fixture.assembly.preservedMounts
  .filter((mount) => mount.id.startsWith("motor-mount"))
  .map((mount) => volumePart(fastener.envelope, {
    id: `fastener-${mount.id}`,
    selectionId: fastener.id,
    label: "Motor fastener",
    appearance: "component",
  }, [millimetres(mount.position.x), millimetres(mount.position.y), millimetres(mount.position.z)]));

const designRegion = volumePart(fixture.assembly.targetEnvelope, {
  id: "arm-design-region",
  selectionId: "arm-design-region",
  label: "Arm design region",
  appearance: "design-region",
});

const constraints = fixture.assembly.obstacleVolumes.map((volume) => volumePart(volume, {
  id: volume.id,
  selectionId: volume.id,
  label: volume.id === "propeller-keep-out" ? "Propeller clearance" : "Cable clearance",
  appearance: "constraint",
}));

export const DRONE_ARM_VISUALS: readonly AssemblyVisualPart[] = Object.freeze([
  designRegion,
  ...componentParts,
  ...fastenerParts,
  ...constraints,
]);
