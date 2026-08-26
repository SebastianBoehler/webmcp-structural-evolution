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

const midpoint = (point: Point3): Point3 => [point[0] / 2, point[1] / 2, 3];
const armLength = (point: Point3) => Math.hypot(point[0], point[1]) - 30;
const armYaw = (point: Point3) => Math.atan2(point[1], point[0]);

function motorGroup(motor: MotorPlacement): readonly AssemblyVisualPart[] {
  const [x, y, z] = motor.center;
  const dragGroup = motor.id;
  return [
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

function armPart(motor: MotorPlacement, active: boolean): AssemblyVisualPart {
  const length = armLength(motor.center);
  const center = midpoint(motor.center);
  return {
    id: active ? "arm-design-region" : `reference-arm-${motor.id}`,
    selectionId: active ? "arm-design-region" : `reference-arm-${motor.id}`,
    label: active ? "East arm design region" : `${motor.label} reference arm`,
    appearance: active ? "design-region" : "component",
    kind: "box",
    center,
    rotation: [0, 0, armYaw(motor.center)],
    size: [length, 18, active ? 18 : 7],
  };
}

function importedPart(component: ImportedComponent, index: number, center?: Point3): AssemblyVisualPart {
  return {
    id: component.id,
    selectionId: component.id,
    label: component.name,
    appearance: "component",
    kind: "model",
    center: center ?? [index * 38 - 19, 0, 22],
    movable: true,
    dragGroup: component.id,
    assetUrl: component.assetUrl,
    assetUnits: component.assetUnits,
    size: component.sizeMm,
  };
}

export function droneAssemblyVisuals(
  motors: readonly MotorPlacement[],
  imports: readonly ImportedComponent[],
  importPositions: Readonly<Record<string, Point3>> = {},
): readonly AssemblyVisualPart[] {
  const activeMotor = motors.find((motor) => motor.id === "motor-east") ?? motors[0]!;
  return Object.freeze([
    {
      id: "frame-core",
      selectionId: "frame-core",
      label: "Avionics frame",
      appearance: "component",
      kind: "box",
      center: [0, 0, 3],
      size: [52, 52, 8],
    },
    armPart(activeMotor, true),
    ...motors.filter((motor) => motor.id !== activeMotor.id).map((motor) => armPart(motor, false)),
    ...motors.flatMap(motorGroup),
    ...imports.map((component, index) => importedPart(component, index, importPositions[component.id])),
  ]);
}
