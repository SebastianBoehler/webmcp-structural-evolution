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
const roundedPoint = (value: Point3): Point3 => value.map((coordinate) => Math.round(coordinate * 1e9) / 1e9) as unknown as Point3;

const motorComponent = referenceComponent("motor-2207");
const propellerComponent = referenceComponent("propeller-5x4.3x3");
const fastenerComponent = referenceComponent("fastener-m3x8");
const flightControllerComponent = referenceComponent("flight-controller-30x30");
const escComponent = referenceComponent("esc-30x30");
const batteryComponent = referenceComponent("battery-6s-1550");
const batteryStrapComponent = referenceComponent("battery-retention-strap");
const wiringComponent = referenceComponent("motor-wiring-corridor");
const batteryHarnessComponent = referenceComponent("battery-power-harness");
const bodyComponent = referenceComponent("body-interface");
const propellerDisplay = propellerRenderContract(propellerComponent);
const motorDisplay = motorRenderContract(motorComponent);
const fastenerDisplay = fastenerRenderContract(fastenerComponent);
const flightControllerDisplay = boxRenderContract(flightControllerComponent, "openfc-lite-rev3.3-envelope");
const escDisplay = boxRenderContract(escComponent, "openesc-30x30-rev3.3-envelope");
const batteryDisplay = boxRenderContract(batteryComponent, "battery-package");
const bodyDisplay = boxRenderContract(bodyComponent, "body-interface-plate");

const motorLabels: Readonly<Record<string, string>> = Object.freeze({
  "motor-east": "East motor", "motor-north": "North motor", "motor-west": "West motor", "motor-south": "South motor",
});
export const INITIAL_MOTORS: readonly MotorPlacement[] = Object.freeze(referenceAssemblyInstancesFor("motor-2207")
  .map(({ instanceId, transform }) => ({ id: instanceId, label: motorLabels[instanceId]!, anchor: lengthPoint(transform.position), movable: true })));
export const INITIAL_EQUIPMENT: Readonly<Record<string, Point3>> = Object.freeze({
  "flight-controller": instancePoint("flight-controller"),
  esc: instancePoint("esc"),
  battery: instancePoint("battery"),
  "fpv-camera": instancePoint("fpv-camera"),
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
  const flightControllerCenter = equipment["flight-controller"]!;
  const escCenter = equipment.esc!;
  const batteryCenter = equipment.battery!;
  const cameraCenter = equipment["fpv-camera"]!;
  return [
    { id: "flight-controller", selectionId: "flight-controller", label: "OpenFC-Lite rev3.3 flight controller", appearance: "component", kind: "flight-controller", center: add(flightControllerCenter, viewerPoint(flightControllerDisplay.center)), size: viewerPoint(flightControllerDisplay.size), movable: true, dragGroup: "flight-controller" },
    boxConstraint("flight-controller", "OpenFC-Lite protected volume", flightControllerCenter, flightControllerComponent, "flight-controller"),
    { id: "esc", selectionId: "esc", label: "OpenESC-30x30 rev3.3", appearance: "component", kind: "flight-controller", center: add(escCenter, viewerPoint(escDisplay.center)), size: viewerPoint(escDisplay.size), movable: true, dragGroup: "esc" },
    boxConstraint("esc", "OpenESC-30x30 protected volume", escCenter, escComponent, "esc"),
    { id: "battery", selectionId: "battery", label: "Tattu R-Line V5 1550mAh 6S battery", appearance: "component", kind: "box", center: batteryCenter, size: viewerPoint(batteryDisplay.size), movable: true, dragGroup: "battery" },
    boxConstraint("battery", "Battery protected volume", batteryCenter, batteryComponent, "battery"),
    { id: "fpv-camera", selectionId: "fpv-camera", label: "RunCam Phoenix 2 FPV camera", appearance: "component", kind: "box", center: cameraCenter, size: [31, 20, 19] },
    { id: "fpv-camera-camera-keepout", selectionId: "fpv-camera-camera-keepout", label: "FPV camera protected volume", appearance: "constraint", kind: "box", center: [49.363961031, 49.363961031, 3], rotation: [0, 0, Math.PI / 4], size: [40, 24, 23], dragGroup: "fpv-camera" },
  ];
}

function staticConstraintParts(): readonly AssemblyVisualPart[] {
  const wiring = referenceAssemblyInstancesFor("motor-wiring-corridor").flatMap((instance) =>
    wiringComponent.protectedVolumes.map((volume): AssemblyVisualPart => {
      if (volume.kind !== "box") throw new Error("Motor harness route requires box keep-outs");
      return { id: `${instance.instanceId}-${volume.id}`, selectionId: `${instance.instanceId}-${volume.id}`, label: "Protected 20AWG motor wiring corridor", appearance: "constraint", kind: "box", center: roundedPoint(add(lengthPoint(instance.transform.position), lengthPoint(volume.center))), rotation: [0, 0, instance.transform.orientation.yaw.value], size: lengthPoint(volume.size) };
    }));
  const straps = referenceAssemblyInstancesFor("battery-retention-strap").flatMap((instance) =>
    batteryStrapComponent.protectedVolumes.map((volume): AssemblyVisualPart => {
      if (volume.kind !== "box") throw new Error("Battery strap clearance requires box keep-outs");
      return { id: `${instance.instanceId}-${volume.id}`, selectionId: `${instance.instanceId}-${volume.id}`, label: "Battery strap pass-through clearance", appearance: "constraint", kind: "box", center: roundedPoint(add(lengthPoint(instance.transform.position), lengthPoint(volume.center))), size: lengthPoint(volume.size) };
    }));
  const bodyCenter = instancePoint("body-interface");
  const batteryHarnessCenter = instancePoint("battery-power-harness");
  return [
    { id: "body-interface", selectionId: "body-interface", label: "Frame body interface", appearance: "component", kind: "box", center: add(bodyCenter, viewerPoint(bodyDisplay.center)), size: viewerPoint(bodyDisplay.size) },
    boxConstraint("body-interface", "Body cable clearance", bodyCenter, bodyComponent),
    ...batteryHarnessComponent.protectedVolumes.map((volume): AssemblyVisualPart => {
      if (volume.kind !== "box") throw new Error("Battery harness route requires box keep-outs");
      return { id: `battery-power-harness-${volume.id}`, selectionId: `battery-power-harness-${volume.id}`, label: "Protected battery power harness", appearance: "constraint", kind: "box", center: roundedPoint(add(batteryHarnessCenter, lengthPoint(volume.center))), size: lengthPoint(volume.size) };
    }),
    ...straps,
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
