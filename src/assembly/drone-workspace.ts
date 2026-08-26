import type { AssemblyVisualPart } from "../viewer/render-envelope";
import {
  REFERENCE_DRONE_CATALOG,
  referenceDroneAssembly,
  type ReferenceDroneComponent,
  type ReferenceGeometry,
  type SiVector,
} from "../samples/reference-drone-catalog";
import type { ImportedComponent } from "./component-import";

export type Point3 = readonly [number, number, number];

export interface MotorPlacement {
  readonly id: string;
  readonly label: string;
  readonly center: Point3;
  readonly movable: boolean;
}

const millimetres = (value: number) => value * 1_000;
const viewerPoint = (value: SiVector): Point3 => value.map(millimetres) as unknown as Point3;
const catalogComponent = (id: string): ReferenceDroneComponent => {
  const component = REFERENCE_DRONE_CATALOG.find((candidate) => candidate.id === id);
  if (!component) throw new Error(`Reference drone component missing: ${id}`);
  return component;
};
const componentGeometry = <Kind extends ReferenceGeometry["kind"]>(
  component: ReferenceDroneComponent,
  kind: Kind,
): Extract<ReferenceGeometry, { kind: Kind }> => {
  if (component.geometry.kind !== kind) throw new Error(`Reference ${component.id} geometry must be ${kind}`);
  return component.geometry as Extract<ReferenceGeometry, { kind: Kind }>;
};
const assemblyInstance = (id: string) => {
  const instance = referenceDroneAssembly.instances.find((candidate) => candidate.id === id);
  if (!instance) throw new Error(`Reference drone instance missing: ${id}`);
  return instance;
};
const motorComponent = catalogComponent("motor-2207");
const propellerComponent = catalogComponent("propeller-5x4.3x3");
const fastenerComponent = catalogComponent("fastener-m3x8");
const stackComponent = catalogComponent("fc-esc-stack-30x30");
const batteryComponent = catalogComponent("battery-6s-1550");
const wiringComponent = catalogComponent("motor-wiring-corridor");
const motorGeometry = componentGeometry(motorComponent, "parametric");
const fastenerGeometry = componentGeometry(fastenerComponent, "parametric");
const propellerGeometry = componentGeometry(propellerComponent, "swept-rotor");
const stackGeometry = componentGeometry(stackComponent, "stack");
const batteryGeometry = componentGeometry(batteryComponent, "box");
const wiringGeometry = componentGeometry(wiringComponent, "corridor");
if (motorGeometry.display.kind !== "motor") throw new Error("Reference motor display geometry is invalid");
if (fastenerGeometry.display.kind !== "fastener") throw new Error("Reference fastener display geometry is invalid");
const motorDisplay = motorGeometry.display;
const fastenerDisplay = fastenerGeometry.display;

const motorLabels: Readonly<Record<string, string>> = Object.freeze({
  "motor-east": "East motor", "motor-north": "North motor", "motor-west": "West motor", "motor-south": "South motor",
});
export const INITIAL_MOTORS: readonly MotorPlacement[] = Object.freeze(referenceDroneAssembly.instances
  .filter(({ componentId }) => componentId === motorComponent.id)
  .map(({ id, position }) => ({ id, label: motorLabels[id]!, center: viewerPoint(position), movable: true })));

export const INITIAL_EQUIPMENT: Readonly<Record<string, Point3>> = Object.freeze({
  "flight-controller": viewerPoint(assemblyInstance("fc-esc-stack").position),
  battery: viewerPoint(assemblyInstance("battery").position),
});

function motorGroup(motor: MotorPlacement): readonly AssemblyVisualPart[] {
  const [x, y, z] = motor.center;
  const dragGroup = motor.id;
  const display = motorDisplay;
  const propeller = propellerGeometry;
  const fastener = fastenerDisplay;
  const propellerOffset = millimetres(
    assemblyInstance(`${motor.id}-propeller`).position[2] - assemblyInstance(motor.id).position[2],
  );
  const fastenerCenterZ = z - millimetres(display.bodyHeight / 2 + (fastener.shankLength - fastener.headHeight) / 2);
  return [
    {
      id: `${motor.id}-mount`,
      selectionId: "arm-design-region",
      label: `${motor.label} load-bearing plate`,
      appearance: "generated",
      kind: "motor-mount",
      center: [x, y, 0],
      radius: 17.5,
      height: 6,
      boltCircle: millimetres(display.mountPitchCircle / 2),
      boltRadius: millimetres(fastener.shankRadius),
      dragGroup,
    },
    {
      id: motor.id,
      selectionId: motor.id,
      label: motor.label,
      appearance: "component",
      kind: "motor",
      center: motor.center,
      radius: millimetres(display.radius),
      height: millimetres(display.bodyHeight),
      shaftRadius: millimetres(display.shaftRadius),
      shaftHeight: millimetres(display.shaftHeight),
      movable: motor.movable,
      dragGroup,
    },
    {
      id: `${motor.id}-propeller`,
      selectionId: `${motor.id}-propeller`,
      label: `${motor.label} propeller`,
      appearance: "component",
      kind: "propeller",
      center: [x, y, z + propellerOffset],
      radius: millimetres(propeller.radius),
      hubRadius: millimetres(propeller.hubRadius),
      hubHeight: millimetres(propeller.hubHeight),
      bladeCount: propeller.bladeCount,
      movable: motor.movable,
      dragGroup,
    },
    {
      id: `${motor.id}-guard`,
      selectionId: `${motor.id}-guard`,
      label: `${motor.label} rotor safety zone`,
      appearance: "constraint",
      kind: "guard",
      center: [x, y, z + propellerOffset],
      radius: millimetres(propellerComponent.protectedEnvelopes[0]!.radius!),
      tubeRadius: 1.15,
      dragGroup,
    },
    ...motorComponent.interfaces.filter(({ kind }) => kind === "mount").map((mount, index): AssemblyVisualPart => ({
      id: `${motor.id}-fastener-${index + 1}`,
      selectionId: `${motor.id}-fastener-${index + 1}`,
      label: `${motor.label} M3x8 fastener ${index + 1}`,
      appearance: "component",
      kind: "cylinder",
      center: [x + millimetres(mount.position[0]), y + millimetres(mount.position[1]), fastenerCenterZ],
      radius: millimetres(fastener.headRadius),
      height: millimetres(fastener.shankLength + fastener.headHeight),
      dragGroup,
    })),
  ];
}

function equipmentParts(equipmentPositions: Readonly<Record<string, Point3>>): readonly AssemblyVisualPart[] {
  const stackCenter = equipmentPositions["flight-controller"]!;
  const [x, y, z] = stackCenter;
  const [flightController, esc] = stackGeometry.boards;
  const gap = millimetres(stackGeometry.boardGap);
  const protectedStack = stackComponent.protectedEnvelopes[0]!;
  const batteryCenter = equipmentPositions.battery!;
  const protectedBattery = batteryComponent.protectedEnvelopes[0]!;
  return [
    { id: "flight-controller", selectionId: "flight-controller", label: "SpeedyBee F405 V4 flight controller", appearance: "component", kind: "flight-controller", center: [x, y, z + gap / 2 + millimetres(flightController!.size[2]) / 2], size: viewerPoint(flightController!.size), movable: true, dragGroup: "flight-controller" },
    { id: "flight-controller-esc", selectionId: "flight-controller", label: "SpeedyBee BLS 55A 4-in-1 ESC", appearance: "component", kind: "flight-controller", center: [x, y, z - gap / 2 - millimetres(esc!.size[2]) / 2], size: viewerPoint(esc!.size), movable: true, dragGroup: "flight-controller" },
    { id: "flight-controller-keepout", selectionId: "flight-controller-keepout", label: "Avionics stack protected volume", appearance: "constraint", kind: "box", center: stackCenter, size: viewerPoint(protectedStack.size!), dragGroup: "flight-controller" },
    { id: "battery", selectionId: "battery", label: "Tattu R-Line V5 1550mAh 6S battery", appearance: "component", kind: "box", center: batteryCenter, size: viewerPoint(batteryGeometry.size), movable: true, dragGroup: "battery" },
    { id: "battery-keepout", selectionId: "battery-keepout", label: "Battery protected volume", appearance: "constraint", kind: "box", center: batteryCenter, size: viewerPoint(protectedBattery.size!), dragGroup: "battery" },
  ];
}

function wiringParts(): readonly AssemblyVisualPart[] {
  return referenceDroneAssembly.instances.filter(({ componentId }) => componentId === wiringComponent.id)
    .map((instance): AssemblyVisualPart => ({
      id: instance.id,
      selectionId: instance.id,
      label: "Protected 20AWG motor wiring corridor",
      appearance: "constraint",
      kind: "box",
      center: viewerPoint(instance.position),
      rotation: [0, 0, instance.yaw],
      size: viewerPoint(wiringGeometry.size),
    }));
}

function importedPart(component: ImportedComponent, index: number, center?: Point3): AssemblyVisualPart {
  const shared = {
    id: component.id,
    selectionId: component.id,
    label: component.name,
    appearance: "component" as const,
    center: center ?? [index * 38 - 19, 0, 22] as Point3,
    movable: true,
    dragGroup: component.id,
    size: component.sizeMm,
  };
  if (component.mesh) return { ...shared, kind: "mesh", mesh: component.mesh };
  return {
    ...shared,
    kind: "model",
    assetUrl: component.assetUrl,
    assetUnits: component.assetUnits,
  };
}

export function droneAssemblyVisuals(
  motors: readonly MotorPlacement[],
  imports: readonly ImportedComponent[],
  importPositions: Readonly<Record<string, Point3>> = {},
  equipmentPositions: Readonly<Record<string, Point3>> = INITIAL_EQUIPMENT,
): readonly AssemblyVisualPart[] {
  return Object.freeze([
    {
      id: "arm-design-region",
      selectionId: "arm-design-region",
      label: "Full frame design space",
      appearance: "design-region",
      kind: "box",
      center: [0, 0, 0],
      size: [240, 240, 24],
    },
    ...equipmentParts(equipmentPositions),
    ...wiringParts(),
    ...motors.flatMap(motorGroup),
    ...imports.map((component, index) => importedPart(component, index, importPositions[component.id])),
  ]);
}
