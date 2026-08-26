import { defineAssemblyDraft, type AssemblyDraft } from "../domain/assembly-model";
import type { ComponentDefinition } from "../domain/component-model";
import { REFERENCE_DRONE_CATALOG, referenceComponent } from "./reference-drone-catalog";

const m = (value: number) => ({ value, unit: "m" as const });
const rad = (value: number) => ({ value, unit: "rad" as const });
const point = (x: number, y: number, z: number) => ({ x: m(x), y: m(y), z: m(z) });
const orientation = (yaw = 0) => ({ roll: rad(0), pitch: rad(0), yaw: rad(yaw) });
const transform = (position: readonly [number, number, number], yaw = 0) => ({
  position: point(...position), orientation: orientation(yaw),
});
const targetEnvelope = {
  kind: "box" as const,
  id: "reference-frame-envelope",
  center: point(0, 0, 0),
  size: point(0.24, 0.24, 0.024),
  orientation: orientation(),
};

type AssemblyInstance = AssemblyDraft["components"][number];
type ComponentVolumeField = "collisionVolumes" | "protectedVolumes";
type ComponentVolume = ComponentDefinition[ComponentVolumeField][number];

const motorCenters = [
  ["motor-east", 0.105, 0, 0],
  ["motor-north", 0, 0.105, Math.PI / 2],
  ["motor-west", -0.105, 0, Math.PI],
  ["motor-south", 0, -0.105, -Math.PI / 2],
] as const;
export const REFERENCE_MOTOR_MOUNT_PLATE = Object.freeze({
  radius: 0.0175,
  height: 0.006,
  centerFromMotorAnchor: [0, 0, -0.003] as const,
});
const motorComponent = referenceComponent("motor-2207");
const coordinate = (length: { readonly value: number; readonly unit: "m" | "mm" }) =>
  length.unit === "m" ? length.value : length.value / 1_000;
const propellerSeat = motorComponent.interfaces.find(({ id }) => id === "propeller-shaft-seat");
if (!propellerSeat) throw new Error("Reference motor propeller seat is missing");
const requirement = (instanceId: string, componentId: string, position: readonly [number, number, number], yaw = 0) => ({
  instanceId,
  componentRevision: referenceComponent(componentId).revision,
  quantity: 1,
  transform: transform(position, yaw),
});

const requirements = [
  ...motorCenters.map(([id, x, y, yaw]) => requirement(id, "motor-2207", [x, y, 0.003], yaw)),
  ...motorCenters.map(([id, x, y, yaw]) => requirement(`${id}-propeller`, "propeller-5x4.3x3", [
    x + coordinate(propellerSeat.position.x),
    y + coordinate(propellerSeat.position.y),
    0.003 + coordinate(propellerSeat.position.z),
  ], yaw)),
  ...motorCenters.flatMap(([id, x, y, yaw]) => motorComponent.mountInterfaces.map((motorMount, index) =>
    requirement(`${id}-fastener-${index + 1}`, "fastener-m3x8", [
      x + Math.cos(yaw) * coordinate(motorMount.position.x) - Math.sin(yaw) * coordinate(motorMount.position.y),
      y + Math.sin(yaw) * coordinate(motorMount.position.x) + Math.cos(yaw) * coordinate(motorMount.position.y),
      0.003 + REFERENCE_MOTOR_MOUNT_PLATE.centerFromMotorAnchor[2] - REFERENCE_MOTOR_MOUNT_PLATE.height / 2,
    ], yaw))),
  requirement("flight-controller", "flight-controller-30x30", [0, 0, 0.020]),
  requirement("esc", "esc-30x30", [0, 0, 0.010]),
  requirement("battery", "battery-6s-1550", [-0.001524, -0.001524, -0.032]),
  requirement("battery-strap-front", "battery-retention-strap", [0.022476, -0.001524, -0.032]),
  requirement("battery-strap-rear", "battery-retention-strap", [-0.025524, -0.001524, -0.032]),
  requirement("battery-power-harness", "battery-power-harness", [0.048638, -0.006762, -0.004]),
  requirement("fpv-camera", "fpv-camera", [0.043, 0.043, 0.003], Math.PI / 4),
  requirement("wiring-east", "motor-wiring-corridor", [0.057, 0, 0.008]),
  requirement("wiring-north", "motor-wiring-corridor", [0, 0.057, 0.008], Math.PI / 2),
  requirement("wiring-west", "motor-wiring-corridor", [-0.057, 0, 0.008], Math.PI),
  requirement("wiring-south", "motor-wiring-corridor", [0, -0.057, 0.008], -Math.PI / 2),
  requirement("body-interface", "body-interface", [0, 0, 0]),
] as const;

const rounded = (value: number) => Math.round(value * 1e12) / 1e12;
const value = coordinate;

export function referenceComponentForInstance(instance: AssemblyInstance): ComponentDefinition {
  const component = REFERENCE_DRONE_CATALOG.find(({ revision }) => revision === instance.componentRevision);
  if (!component) throw new Error(`Reference component revision missing: ${instance.componentRevision}`);
  return component;
}

function worldPoint(instance: AssemblyInstance, component: ComponentDefinition, local: ComponentDefinition["centerOfMass"]) {
  const yaw = instance.transform.orientation.yaw.value;
  if (instance.transform.orientation.roll.value !== 0 || instance.transform.orientation.pitch.value !== 0) {
    throw new Error("Reference volume projection currently requires a z-axis-only assembly rotation");
  }
  const localX = value(local.x) - value(component.anchor.position.x);
  const localY = value(local.y) - value(component.anchor.position.y);
  const localZ = value(local.z) - value(component.anchor.position.z);
  return point(
    rounded(value(instance.transform.position.x) + Math.cos(yaw) * localX - Math.sin(yaw) * localY),
    rounded(value(instance.transform.position.y) + Math.sin(yaw) * localX + Math.cos(yaw) * localY),
    rounded(value(instance.transform.position.z) + localZ),
  );
}

function worldVolume(instance: AssemblyInstance, component: ComponentDefinition, volume: ComponentVolume): ComponentVolume {
  const volumeOrientation = volume.orientation;
  return {
    ...volume,
    id: `${instance.instanceId}-${volume.id}`,
    center: worldPoint(instance, component, volume.center),
    orientation: {
      roll: volumeOrientation.roll,
      pitch: volumeOrientation.pitch,
      yaw: rad(volumeOrientation.yaw.value + instance.transform.orientation.yaw.value),
    },
  };
}

function worldVolumesFor(instances: readonly AssemblyInstance[], field: ComponentVolumeField) {
  return instances.flatMap((instance) => {
    const component = referenceComponentForInstance(instance);
    return component[field].map((volume) => worldVolume(instance, component, volume));
  });
}

function worldMountsFor(instances: readonly AssemblyInstance[]) {
  return instances.flatMap((instance) => {
    const component = referenceComponentForInstance(instance);
    return component.mountInterfaces.map((mount) => ({
      ...mount,
      id: `${instance.instanceId}-${mount.id}`,
      position: worldPoint(instance, component, mount.position),
      orientation: {
        roll: mount.orientation.roll,
        pitch: mount.orientation.pitch,
        yaw: rad(mount.orientation.yaw.value + instance.transform.orientation.yaw.value),
      },
    }));
  });
}

export const referenceDroneAssembly = await defineAssemblyDraft({
  id: "reference-5-inch-drone",
  geometryCoordinates: "assembly",
  components: requirements,
  targetEnvelope,
  preservedMounts: worldMountsFor(requirements),
  obstacleVolumes: worldVolumesFor(requirements, "protectedVolumes"),
  accessVolumes: [],
  missingComponents: [],
  incompatibleComponents: [],
  ambiguousComponents: [],
});

export function referenceAssemblyInstance(id: string): AssemblyInstance {
  const instance = referenceDroneAssembly.components.find(({ instanceId }) => instanceId === id);
  if (!instance) throw new Error(`Reference drone instance missing: ${id}`);
  return instance;
}

export function referenceAssemblyInstancesFor(componentId: string): readonly AssemblyInstance[] {
  const revision = referenceComponent(componentId).revision;
  return referenceDroneAssembly.components.filter(({ componentRevision }) => componentRevision === revision);
}

export function referenceAssemblyWorldVolumes(field: ComponentVolumeField): readonly ComponentVolume[] {
  return worldVolumesFor(referenceDroneAssembly.components, field);
}

export function referenceAssemblyWorldMounts(instances: readonly AssemblyInstance[] = referenceDroneAssembly.components) {
  return worldMountsFor(instances);
}

export function referenceWorldVolumesFor(instances: readonly AssemblyInstance[], field: ComponentVolumeField) {
  return worldVolumesFor(instances, field);
}
