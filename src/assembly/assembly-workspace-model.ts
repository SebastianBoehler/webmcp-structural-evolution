import type { AssemblyDraft } from "../domain/assembly-model";
import type { ComponentDefinition } from "../domain/component-model";
import { defineInventory } from "../domain/design";
import { referenceDroneAssembly } from "../samples/reference-drone-assembly";
import { REFERENCE_DRONE_CATALOG } from "../samples/reference-drone-catalog";
import {
  fastenerRenderContract,
  motorRenderContract,
  propellerRenderContract,
  stackRenderContract,
  type AxialFeature,
  type RenderBounds,
  type SiVector,
} from "../samples/reference-drone-render-contract";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import { createAssemblyAuthoringState } from "./assembly-authoring";
import type { ImportedComponent } from "./component-import";
import type { CadMesh } from "./step-import";

export type Point3 = readonly [number, number, number];
export interface ComponentRenderResource {
  readonly name: string;
  readonly category: ImportedComponent["category"];
  readonly assetUrl: string;
  readonly assetUnits: "m" | "mm";
  readonly sourceUrl: string;
  readonly sizeMm: [number, number, number];
  readonly validation: ImportedComponent["validation"];
  readonly stagedBy: ImportedComponent["stagedBy"];
  readonly mesh?: CadMesh;
}

const mm = (value: { readonly value: number; readonly unit: "m" | "mm" }) =>
  Math.round((value.unit === "m" ? value.value * 1_000 : value.value) * 1e9) / 1e9;
const point = (value: ComponentDefinition["centerOfMass"]): Point3 =>
  [mm(value.x), mm(value.y), mm(value.z)];
const renderPoint = (value: SiVector): Point3 => value.map((item) => item * 1_000) as unknown as Point3;
const add = (left: Point3, right: Point3): Point3 => left.map((value, axis) => value + right[axis]!) as unknown as Point3;
const subtract = (left: Point3, right: Point3): Point3 => left.map((value, axis) => value - right[axis]!) as unknown as Point3;
function rotate([x, y, z]: Point3, [roll, pitch, yaw]: Point3): Point3 {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [cy * cp * x + (cy * sp * sr - sy * cr) * y + (cy * sp * cr + sy * sr) * z, sy * cp * x + (sy * sp * sr + cy * cr) * y + (sy * sp * cr - cy * sr) * z, -sp * x + cp * sr * y + cp * cr * z];
}
const feature = (value: AxialFeature) => ({ radius: value.radius * 1_000, height: value.height * 1_000, centerZ: value.centerZ * 1_000 });
const bounds = (value: RenderBounds) => ({ minimum: renderPoint(value.minimum), maximum: renderPoint(value.maximum) });
const labelFor = (instanceId: string, component: ComponentDefinition) => {
  const direction = /motor-(east|north|west|south)/.exec(instanceId)?.[1];
  return direction ? `${direction[0]!.toUpperCase()}${direction.slice(1)} ${component.category}` : component.partNumber;
};
const dragGroupFor = (instanceId: string, draft: AssemblyDraft) => {
  const motor = draft.components.find(({ instanceId: id, componentRevision }) =>
    id === instanceId || instanceId.startsWith(`${id}-`) && component(draft, componentRevision)?.category === "motor");
  return motor?.instanceId ?? instanceId;
};
const component = (_draft: AssemblyDraft, revision: string, catalog: readonly ComponentDefinition[] = REFERENCE_DRONE_CATALOG) =>
  catalog.find((candidate) => candidate.revision === revision);

function protectedPart(id: string, label: string, center: Point3, volume: ComponentDefinition["protectedVolumes"][number], dragGroup: string, localCenter = point(volume.center), baseRotation: Point3 = [0, 0, 0]): AssemblyVisualPart {
  const rotation = add(baseRotation, [volume.orientation.roll.value, volume.orientation.pitch.value, volume.orientation.yaw.value]);
  const shared = { id, selectionId: id, label, appearance: "constraint" as const, center: add(center, localCenter), rotation, dragGroup };
  return volume.kind === "box"
    ? { ...shared, kind: "box", size: point(volume.size) }
    : { ...shared, kind: "protected-disc", radius: mm(volume.radius), height: mm(volume.height) };
}

function componentParts(
  draft: AssemblyDraft,
  instance: AssemblyDraft["components"][number],
  definition: ComponentDefinition,
  resource?: ComponentRenderResource,
): readonly AssemblyVisualPart[] {
  const center = point(instance.transform.position);
  const rotation: Point3 = [instance.transform.orientation.roll.value, instance.transform.orientation.pitch.value, instance.transform.orientation.yaw.value];
  const localCenter = (value: ComponentDefinition["centerOfMass"]) => rotate(subtract(point(value), point(definition.anchor.position)), rotation);
  const dragGroup = dragGroupFor(instance.instanceId, draft);
  const shared = { id: instance.instanceId, selectionId: instance.instanceId, label: labelFor(instance.instanceId, definition), appearance: "component" as const, center, rotation, dragGroup };
  let visible: readonly AssemblyVisualPart[];
  if (resource) visible = [resource.mesh
    ? { ...shared, kind: "mesh", mesh: resource.mesh, movable: true }
    : { ...shared, kind: "model", assetUrl: resource.assetUrl, assetUnits: resource.assetUnits, size: resource.sizeMm, movable: true }];
  else if (definition.category === "motor") {
    const display = motorRenderContract(definition);
    visible = [
      { id: `${instance.instanceId}-mount`, selectionId: "arm-design-region", label: `${shared.label} load-bearing plate`, appearance: "generated", kind: "motor-mount", center: add(center, [0, 0, -3]), radius: 17.5, height: 6, boltCircle: Math.hypot(display.mountHoles[0]!.centerX * 1_000, display.mountHoles[0]!.centerY * 1_000), boltRadius: 1.5, dragGroup },
      { ...shared, kind: "motor", base: feature(display.base), stator: feature(display.stator), bell: feature(display.bell), shaft: feature(display.shaft), mountHoles: display.mountHoles.map((hole) => ({ ...feature(hole), centerX: hole.centerX * 1_000, centerY: hole.centerY * 1_000 })), localBounds: bounds(display.localBounds), movable: true },
    ];
  } else if (definition.category === "fastener") {
    const display = fastenerRenderContract(definition);
    visible = [{ ...shared, kind: "fastener", shank: feature(display.shank), head: feature(display.head), socketWidth: display.socketWidth * 1_000, socketDepth: display.socketDepth * 1_000, socketCenterZ: display.socketCenterZ * 1_000, localBounds: bounds(display.localBounds) }];
  } else if (definition.category === "propeller") {
    const display = propellerRenderContract(definition);
    visible = [{ ...shared, kind: "propeller", radius: display.radius * 1_000, hubRadius: display.hubRadius * 1_000, hubHeight: display.hubHeight * 1_000, bladeCount: display.bladeCount, movable: true }];
  } else if (definition.category === "avionics") {
    const display = stackRenderContract(definition);
    visible = [
      { ...shared, id: `${instance.instanceId}-flight-controller`, kind: "flight-controller", center: add(center, renderPoint(display.flightController.center)), size: renderPoint(display.flightController.size), movable: true },
      { ...shared, id: `${instance.instanceId}-esc`, kind: "flight-controller", center: add(center, renderPoint(display.esc.center)), size: renderPoint(display.esc.size), movable: true },
    ];
  } else {
    const envelope = definition.envelope;
    visible = [envelope.kind === "box"
      ? { ...shared, kind: "box", center: add(center, localCenter(envelope.center)), size: point(envelope.size), movable: definition.category === "battery" }
      : { ...shared, kind: "cylinder", center: add(center, localCenter(envelope.center)), radius: mm(envelope.radius), height: mm(envelope.height), movable: definition.category === "battery" }];
  }
  const protectedParts = definition.protectedVolumes.map((volume) => protectedPart(
    `${instance.instanceId}-${volume.id}`, `${shared.label} protected volume`, center, volume, dragGroup, localCenter(volume.center), rotation,
  ));
  const guard = definition.category === "propeller" && definition.protectedVolumes[0]?.kind === "cylinder"
    ? [{ ...shared, id: `${dragGroup}-guard`, selectionId: `${dragGroup}-guard`, label: `${shared.label} rotor safety zone`, appearance: "constraint" as const, kind: "guard" as const, radius: mm(definition.protectedVolumes[0].radius), tubeRadius: 1.15 }]
    : [];
  return [...visible, ...protectedParts, ...guard];
}

export function renderPartsForAssembly(
  draft: AssemblyDraft,
  catalog: readonly ComponentDefinition[],
  resources: Readonly<Record<string, ComponentRenderResource>> = {},
): readonly AssemblyVisualPart[] {
  const target = draft.targetEnvelope;
  const designRegion: AssemblyVisualPart = target.kind === "box"
    ? { id: "arm-design-region", selectionId: "arm-design-region", label: "Full frame design space", appearance: "design-region", kind: "box", center: point(target.center), size: point(target.size) }
    : { id: "arm-design-region", selectionId: "arm-design-region", label: "Full frame design space", appearance: "design-region", kind: "cylinder", center: point(target.center), radius: mm(target.radius), height: mm(target.height) };
  const parts = draft.components.flatMap((instance) => {
    const definition = catalog.find(({ revision }) => revision === instance.componentRevision);
    return definition ? componentParts(draft, instance, definition, resources[definition.revision]) : [];
  });
  const represented = new Set(parts.map(({ id }) => id));
  const declaredRegions = [...draft.obstacleVolumes, ...draft.accessVolumes].flatMap((volume) => {
    if (represented.has(volume.id)) return [];
    return [protectedPart(volume.id, `Protected region ${volume.id}`, [0, 0, 0], volume, volume.id)];
  });
  return Object.freeze([designRegion, ...parts, ...declaredRegions]);
}

const required = new Map<string, number>();
for (const instance of referenceDroneAssembly.components) required.set(instance.componentRevision, (required.get(instance.componentRevision) ?? 0) + instance.quantity);
export const INITIAL_DRONE_INVENTORY = defineInventory([...required].map(([componentRevision, ownedQuantity]) => ({ componentRevision, ownedQuantity, availability: "available" })));
export const initialDroneWorkspace = await createAssemblyAuthoringState(referenceDroneAssembly, REFERENCE_DRONE_CATALOG);
