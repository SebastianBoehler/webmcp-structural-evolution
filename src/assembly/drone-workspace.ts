import type { ComponentDefinition } from "../domain/component-model";
import {
  referenceAssemblyInstance,
  referenceAssemblyInstancesFor,
  REFERENCE_MOTOR_MOUNT_PLATE,
} from "../samples/reference-drone-assembly";
import { referenceComponent } from "../samples/reference-drone-catalog";
import {
  boxRenderContract,
  fastenerRenderContract,
  motorRenderContract,
  propellerRenderContract,
  stackRenderContract,
  type AxialFeature,
  type RenderBounds,
  type SiVector,
} from "../samples/reference-drone-render-contract";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import type { ImportedComponent } from "./component-import";

export {
  INITIAL_DRONE_INVENTORY,
  initialDroneWorkspace,
  renderPartsForAssembly,
  type ComponentRenderResource,
} from "./assembly-workspace-model";

export type Point3 = readonly [number, number, number];
export interface MotorPlacement {
  readonly id: string;
  readonly label: string;
  readonly anchor: Point3;
  readonly movable: boolean;
}

const millimetres = (value: number) => Math.round(value * 1_000_000_000) / 1_000_000;
const viewerPoint = (value: SiVector): Point3 => value.map(millimetres) as unknown as Point3;
const lengthPoint = (value: ComponentDefinition["centerOfMass"]): Point3 => viewerPoint([
  value.x.value, value.y.value, value.z.value,
]);
const instancePoint = (id: string): Point3 => lengthPoint(referenceAssemblyInstance(id).transform.position);
const viewerFeature = (feature: AxialFeature) => ({
  radius: millimetres(feature.radius), height: millimetres(feature.height), centerZ: millimetres(feature.centerZ),
});
const viewerBounds = (bounds: RenderBounds) => ({
  minimum: viewerPoint(bounds.minimum), maximum: viewerPoint(bounds.maximum),
});
const offset = (left: Point3, right: Point3): Point3 => left.map((value, axis) => value - right[axis]!) as unknown as Point3;
const add = (left: Point3, right: Point3): Point3 => left.map((value, axis) => value + right[axis]!) as unknown as Point3;

const motorComponent = referenceComponent("motor-2207");
const propellerComponent = referenceComponent("propeller-5x4.3x3");
const fastenerComponent = referenceComponent("fastener-m3x8");
const stackComponent = referenceComponent("fc-esc-stack-30x30");
const batteryComponent = referenceComponent("battery-6s-1550");
const wiringComponent = referenceComponent("motor-wiring-corridor");
const bodyComponent = referenceComponent("body-interface");
const propellerDisplay = propellerRenderContract(propellerComponent);
const motorDisplay = motorRenderContract(motorComponent);
const fastenerDisplay = fastenerRenderContract(fastenerComponent);
const stackDisplay = stackRenderContract(stackComponent);
const batteryDisplay = boxRenderContract(batteryComponent, "battery-package");
const wiringDisplay = boxRenderContract(wiringComponent, "wiring-corridor");
const bodyDisplay = boxRenderContract(bodyComponent, "body-interface-plate");

const motorLabels: Readonly<Record<string, string>> = Object.freeze({
  "motor-east": "East motor", "motor-north": "North motor", "motor-west": "West motor", "motor-south": "South motor",
});
export const INITIAL_MOTORS: readonly MotorPlacement[] = Object.freeze(referenceAssemblyInstancesFor("motor-2207")
  .map(({ instanceId, transform }) => ({ id: instanceId, label: motorLabels[instanceId]!, anchor: lengthPoint(transform.position), movable: true })));
export const INITIAL_EQUIPMENT: Readonly<Record<string, Point3>> = Object.freeze({
  "flight-controller": instancePoint("fc-esc-stack"),
  battery: instancePoint("battery"),
});

function protectedCylinder(component: ComponentDefinition) {
  const volume = component.protectedVolumes[0];
  if (volume?.kind !== "cylinder") throw new Error(`Reference ${component.id} requires a protected cylinder`);
  return volume;
}

function protectedBox(component: ComponentDefinition) {
  const volume = component.protectedVolumes[0];
  if (volume?.kind !== "box") throw new Error(`Reference ${component.id} requires a protected box`);
  return volume;
}

function motorGroup(motor: MotorPlacement): readonly AssemblyVisualPart[] {
  const dragGroup = motor.id;
  const originalMotor = instancePoint(motor.id);
  const propellerId = `${motor.id}-propeller`;
  const propellerCenter = add(motor.anchor, offset(instancePoint(propellerId), originalMotor));
  const swept = protectedCylinder(propellerComponent);
  const motorFasteners = referenceAssemblyInstancesFor("fastener-m3x8")
    .filter(({ instanceId }) => instanceId.startsWith(`${motor.id}-fastener-`));
  return [
    { id: `${motor.id}-mount`, selectionId: "arm-design-region", label: `${motor.label} load-bearing plate`, appearance: "generated", kind: "motor-mount", center: add(motor.anchor, viewerPoint(REFERENCE_MOTOR_MOUNT_PLATE.centerFromMotorAnchor)), radius: millimetres(REFERENCE_MOTOR_MOUNT_PLATE.radius), height: millimetres(REFERENCE_MOTOR_MOUNT_PLATE.height), boltCircle: Math.hypot(millimetres(motorDisplay.mountHoles[0]!.centerX), millimetres(motorDisplay.mountHoles[0]!.centerY)), boltRadius: millimetres(fastenerDisplay.shank.radius), dragGroup },
    { id: motor.id, selectionId: motor.id, label: motor.label, appearance: "component", kind: "motor", center: motor.anchor, base: viewerFeature(motorDisplay.base), stator: viewerFeature(motorDisplay.stator), bell: viewerFeature(motorDisplay.bell), shaft: viewerFeature(motorDisplay.shaft), mountHoles: motorDisplay.mountHoles.map((hole) => ({ ...viewerFeature(hole), centerX: millimetres(hole.centerX), centerY: millimetres(hole.centerY) })), localBounds: viewerBounds(motorDisplay.localBounds), movable: motor.movable, dragGroup },
    { id: propellerId, selectionId: propellerId, label: `${motor.label} propeller`, appearance: "component", kind: "propeller", center: propellerCenter, radius: millimetres(propellerDisplay.radius), hubRadius: millimetres(propellerDisplay.hubRadius), hubHeight: millimetres(propellerDisplay.hubHeight), bladeCount: propellerDisplay.bladeCount, movable: motor.movable, dragGroup },
    { id: `${propellerId}-${swept.id}`, selectionId: `${propellerId}-${swept.id}`, label: `${motor.label} filled protected rotor swept volume`, appearance: "constraint", kind: "protected-disc", center: propellerCenter, radius: millimetres(swept.radius.value), height: millimetres(swept.height.value), dragGroup },
    { id: `${motor.id}-guard`, selectionId: `${motor.id}-guard`, label: `${motor.label} rotor safety zone`, appearance: "constraint", kind: "guard", center: propellerCenter, radius: millimetres(swept.radius.value), tubeRadius: 1.15, dragGroup },
    ...motorFasteners.map((instance, index): AssemblyVisualPart => ({
      id: instance.instanceId,
      selectionId: instance.instanceId,
      label: `${motor.label} M3x8 fastener ${index + 1}`,
      appearance: "component",
      kind: "fastener",
      center: add(motor.anchor, offset(lengthPoint(instance.transform.position), originalMotor)),
      shank: viewerFeature(fastenerDisplay.shank),
      head: viewerFeature(fastenerDisplay.head),
      socketWidth: millimetres(fastenerDisplay.socketWidth),
      socketDepth: millimetres(fastenerDisplay.socketDepth),
      socketCenterZ: millimetres(fastenerDisplay.socketCenterZ),
      localBounds: viewerBounds(fastenerDisplay.localBounds),
      dragGroup,
    })),
  ];
}

function boxConstraint(id: string, label: string, center: Point3, component: ComponentDefinition, dragGroup?: string): AssemblyVisualPart {
  const volume = protectedBox(component);
  return { id: `${id}-${volume.id}`, selectionId: `${id}-${volume.id}`, label, appearance: "constraint", kind: "box", center: add(center, lengthPoint(volume.center)), size: lengthPoint(volume.size), dragGroup };
}

function equipmentParts(equipment: Readonly<Record<string, Point3>>): readonly AssemblyVisualPart[] {
  const stackCenter = equipment["flight-controller"]!;
  const batteryCenter = equipment.battery!;
  return [
    { id: "flight-controller", selectionId: "flight-controller", label: "SpeedyBee F405 V4 flight controller", appearance: "component", kind: "flight-controller", center: add(stackCenter, viewerPoint(stackDisplay.flightController.center)), size: viewerPoint(stackDisplay.flightController.size), movable: true, dragGroup: "flight-controller" },
    { id: "flight-controller-esc", selectionId: "flight-controller", label: "SpeedyBee BLS 55A 4-in-1 ESC", appearance: "component", kind: "flight-controller", center: add(stackCenter, viewerPoint(stackDisplay.esc.center)), size: viewerPoint(stackDisplay.esc.size), movable: true, dragGroup: "flight-controller" },
    boxConstraint("fc-esc-stack", "Avionics stack protected volume", stackCenter, stackComponent, "flight-controller"),
    { id: "battery", selectionId: "battery", label: "Tattu R-Line V5 1550mAh 6S battery", appearance: "component", kind: "box", center: batteryCenter, size: viewerPoint(batteryDisplay.size), movable: true, dragGroup: "battery" },
    boxConstraint("battery", "Battery protected volume", batteryCenter, batteryComponent, "battery"),
  ];
}

function staticConstraintParts(): readonly AssemblyVisualPart[] {
  const wiring = referenceAssemblyInstancesFor("motor-wiring-corridor").map((instance): AssemblyVisualPart => ({
    id: `${instance.instanceId}-keepout`, selectionId: `${instance.instanceId}-keepout`, label: "Protected 20AWG motor wiring corridor", appearance: "constraint", kind: "box", center: lengthPoint(instance.transform.position), rotation: [0, 0, instance.transform.orientation.yaw.value], size: viewerPoint(wiringDisplay.size),
  }));
  const bodyCenter = instancePoint("body-interface");
  return [
    { id: "body-interface", selectionId: "body-interface", label: "Frame body interface", appearance: "component", kind: "box", center: add(bodyCenter, viewerPoint(bodyDisplay.center)), size: viewerPoint(bodyDisplay.size) },
    boxConstraint("body-interface", "Body cable clearance", bodyCenter, bodyComponent),
    ...wiring,
  ];
}

function importedPart(component: ImportedComponent, index: number, center?: Point3): AssemblyVisualPart {
  const shared = { id: component.id, selectionId: component.id, label: component.name, appearance: "component" as const, center: center ?? [index * 38 - 19, 0, 22] as Point3, movable: true, dragGroup: component.id, size: component.sizeMm };
  if (component.mesh) return { ...shared, kind: "mesh", mesh: component.mesh };
  return { ...shared, kind: "model", assetUrl: component.assetUrl, assetUnits: component.assetUnits };
}

export function droneAssemblyVisuals(
  motors: readonly MotorPlacement[],
  imports: readonly ImportedComponent[],
  importPositions: Readonly<Record<string, Point3>> = {},
  equipmentPositions: Readonly<Record<string, Point3>> = INITIAL_EQUIPMENT,
): readonly AssemblyVisualPart[] {
  return Object.freeze([
    { id: "arm-design-region", selectionId: "arm-design-region", label: "Full frame design space", appearance: "design-region", kind: "box", center: [0, 0, 0], size: [240, 240, 24] },
    ...equipmentParts(equipmentPositions),
    ...staticConstraintParts(),
    ...motors.flatMap(motorGroup),
    ...imports.map((component, index) => importedPart(component, index, importPositions[component.id])),
  ]);
}
