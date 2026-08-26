import type { AssemblyVisualPart } from "../viewer/render-envelope";
import type { ImportedComponent } from "./component-import";

export type Point3 = readonly [number, number, number];

export interface MotorPlacement {
  readonly id: string;
  readonly label: string;
  readonly center: Point3;
  readonly movable: boolean;
}

export const INITIAL_MOTORS: readonly MotorPlacement[] = Object.freeze([
  { id: "motor-east", label: "East motor", center: [105, 0, 12], movable: true },
  { id: "motor-north", label: "North motor", center: [0, 105, 12], movable: true },
  { id: "motor-west", label: "West motor", center: [-105, 0, 12], movable: true },
  { id: "motor-south", label: "South motor", center: [0, -105, 12], movable: true },
]);

export const INITIAL_EQUIPMENT: Readonly<Record<string, Point3>> = Object.freeze({
  "flight-controller": [0, 0, 13],
  battery: [0, 0, -14],
  receiver: [-30, 0, 8],
});

function motorGroup(motor: MotorPlacement): readonly AssemblyVisualPart[] {
  const [x, y, z] = motor.center;
  const dragGroup = motor.id;
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
      boltCircle: 9.5,
      boltRadius: 1.6,
      dragGroup,
    },
    {
      id: motor.id,
      selectionId: motor.id,
      label: motor.label,
      appearance: "component",
      kind: "motor",
      center: motor.center,
      radius: 14,
      height: 19.9,
      shaftRadius: 2.5,
      shaftHeight: 12,
      movable: motor.movable,
      dragGroup,
    },
    {
      id: `${motor.id}-propeller`,
      selectionId: `${motor.id}-propeller`,
      label: `${motor.label} propeller`,
      appearance: "component",
      kind: "propeller",
      center: [x, y, z + 18],
      radius: 64.65,
      hubRadius: 7.5,
      hubHeight: 6,
      bladeCount: 3,
      movable: motor.movable,
      dragGroup,
    },
    {
      id: `${motor.id}-guard`,
      selectionId: `${motor.id}-guard`,
      label: `${motor.label} rotor safety zone`,
      appearance: "constraint",
      kind: "guard",
      center: [x, y, z + 18],
      radius: 67,
      tubeRadius: 1.15,
      dragGroup,
    },
  ];
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
    {
      id: "flight-controller", selectionId: "flight-controller", label: "Pixhawk 6C Mini envelope",
      appearance: "component", kind: "flight-controller", center: equipmentPositions["flight-controller"]!,
      size: [54.3, 39, 17.5], movable: true, dragGroup: "flight-controller",
    },
    {
      id: "flight-controller-keepout", selectionId: "flight-controller-keepout", label: "Flight controller protected volume",
      appearance: "constraint", kind: "box", center: equipmentPositions["flight-controller"]!,
      size: [60.3, 45, 23.5], dragGroup: "flight-controller",
    },
    {
      id: "battery", selectionId: "battery", label: "4S LiPo battery",
      appearance: "component", kind: "box", center: equipmentPositions.battery!, size: [72, 34, 28], movable: true, dragGroup: "battery",
    },
    {
      id: "battery-keepout", selectionId: "battery-keepout", label: "Battery protected volume",
      appearance: "constraint", kind: "box", center: equipmentPositions.battery!, size: [78, 40, 34], dragGroup: "battery",
    },
    {
      id: "receiver", selectionId: "receiver", label: "Radio receiver",
      appearance: "component", kind: "box", center: equipmentPositions.receiver!, size: [20, 12, 5], movable: true, dragGroup: "receiver",
    },
    ...([0, Math.PI / 2] as const).map((yaw, index): AssemblyVisualPart => ({
      id: `cable-corridor-${index}`, selectionId: `cable-corridor-${index}`, label: "Protected wiring corridor",
      appearance: "constraint", kind: "box", center: [0, 0, 5], rotation: [0, 0, yaw], size: [184, 6, 6],
    })),
    ...motors.flatMap(motorGroup),
    ...imports.map((component, index) => importedPart(component, index, importPositions[component.id])),
  ]);
}
