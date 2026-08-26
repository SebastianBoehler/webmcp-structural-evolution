import {
  defineAssembly,
  defineComponent,
  defineInventory,
  defineStudy,
  freezeSnapshot,
  type ComponentDefinition,
} from "../domain/design";
import type { ContextSelection } from "../domain/foundation-context";
import { createFoundationContext } from "./foundation-context";

const mm = (value: number) => ({ value, unit: "mm" as const });
const deg = (value: number) => ({ value, unit: "deg" as const });
const newtons = (value: number) => ({ value, unit: "N" as const });
const point = (x: number, y: number, z: number) => ({
  x: mm(x),
  y: mm(y),
  z: mm(z),
});
const orientation = (roll = 0, pitch = 0, yaw = 0) => ({
  roll: deg(roll),
  pitch: deg(pitch),
  yaw: deg(yaw),
});
const identityTransformAt = (position: ReturnType<typeof point>) => ({
  position,
  orientation: orientation(),
});
const box = (
  id: string,
  center: readonly [number, number, number],
  size: readonly [number, number, number],
) => ({
  kind: "box" as const,
  id,
  center: point(...center),
  size: point(...size),
});
const cylinder = (
  id: string,
  center: readonly [number, number, number],
  radius: number,
  height: number,
) => ({
  kind: "cylinder" as const,
  id,
  center: point(...center),
  radius: mm(radius),
  height: mm(height),
  orientation: orientation(),
});
const mount = (id: string, x: number, y: number, z: number) => ({
  id,
  position: point(x, y, z),
  orientation: orientation(),
  diameter: mm(3.2),
  fastenerType: "M3",
});
type LocalPoint = ComponentDefinition["centerOfMass"];
type LocalMount = ComponentDefinition["mountInterfaces"][number];
type LocalVolume = ComponentDefinition["keepOutVolumes"][number];

const metres = (value: { readonly value: number; readonly unit: "mm" | "m" }) =>
  value.unit === "mm" ? value.value / 1_000 : value.value;
const pointMetres = (x: number, y: number, z: number) => ({
  x: { value: x, unit: "m" as const },
  y: { value: y, unit: "m" as const },
  z: { value: z, unit: "m" as const },
});
const translateToMetres = (
  local: LocalPoint,
  assemblyOrigin: ReturnType<typeof point>,
) => pointMetres(
  metres(local.x) + metres(assemblyOrigin.x),
  metres(local.y) + metres(assemblyOrigin.y),
  metres(local.z) + metres(assemblyOrigin.z),
);
const placeMountInAssembly = (
  local: LocalMount,
  assemblyOrigin: ReturnType<typeof point>,
) => ({ ...local, position: translateToMetres(local.position, assemblyOrigin) });
const placeVolumeInAssembly = (
  local: LocalVolume,
  assemblyOrigin: ReturnType<typeof point>,
) => ({ ...local, center: translateToMetres(local.center, assemblyOrigin) });

const motorAssemblyOrigin = point(105, 0, 0);
const bodyAssemblyOrigin = point(0, 0, 0);

const motor = await defineComponent({
  id: "motor-2207",
  category: "motor",
  geometryCoordinates: "component-local",
  manufacturer: "Hobbywing",
  partNumber: "XRotor-2207.5SL-1780KV",
  provenance: {
    kind: "manufacturer-datasheet",
    reference: "https://www.hobbywing.com/en/products/xrotor-22075",
  },
  mass: { value: 38, unit: "g" },
  centerOfMass: point(0, 0, 9.95),
  envelope: cylinder("motor-envelope", [0, 0, 9.95], 14, 19.9),
  mountInterfaces: [
    mount("motor-mount-nw", -5.657, 5.657, 0),
    mount("motor-mount-ne", 5.657, 5.657, 0),
    mount("motor-mount-se", 5.657, -5.657, 0),
    mount("motor-mount-sw", -5.657, -5.657, 0),
  ],
  keepOutVolumes: [cylinder("propeller-keep-out", [0, 0, 30], 64.65, 6)],
  loadContributions: [
    {
      id: "motor-thrust-load",
      force: { x: newtons(0), y: newtons(0), z: newtons(-18) },
    },
  ],
  allowedOrientations: [orientation()],
});

const fastener = await defineComponent({
  id: "m3-fastener",
  category: "fastener",
  geometryCoordinates: "component-local",
  manufacturer: "Generic",
  partNumber: "M3x12-SHCS",
  provenance: { kind: "generic", reference: "ISO 4762 dimensional profile" },
  mass: { value: 2, unit: "g" },
  centerOfMass: point(0, 0, 6),
  envelope: cylinder("fastener-envelope", [0, 0, 6], 2.75, 12),
  mountInterfaces: [],
  keepOutVolumes: [],
  loadContributions: [],
  allowedOrientations: [orientation()],
});

const bodyInterface = await defineComponent({
  id: "body-interface",
  category: "body-interface",
  geometryCoordinates: "component-local",
  manufacturer: "Sunderlabs",
  partNumber: "FRAME-INTERFACE-01",
  provenance: { kind: "user-defined", reference: "foundation interface drawing rev 1" },
  mass: { value: 18, unit: "g" },
  centerOfMass: point(0, 0, 3),
  envelope: box("body-interface-envelope", [0, 0, 3], [28, 38, 6]),
  mountInterfaces: [
    mount("body-mount-north", 0, 12, 0),
    mount("body-mount-south", 0, -12, 0),
  ],
  keepOutVolumes: [box("cable-keep-out", [8, 0, 6], [14, 12, 12])],
  loadContributions: [],
  allowedOrientations: [orientation()],
});

const assembly = await defineAssembly({
  id: "drone-arm-foundation",
  geometryCoordinates: "assembly",
  components: [
    {
      instanceId: "motor",
      componentRevision: motor.revision,
      quantity: 1,
      transform: identityTransformAt(motorAssemblyOrigin),
    },
    {
      instanceId: "motor-fasteners",
      componentRevision: fastener.revision,
      quantity: 4,
      transform: identityTransformAt(motorAssemblyOrigin),
    },
    {
      instanceId: "body-interface",
      componentRevision: bodyInterface.revision,
      quantity: 1,
      transform: identityTransformAt(bodyAssemblyOrigin),
    },
  ],
  targetEnvelope: box("arm-target-envelope", [52.5, 0, 3], [125, 42, 18]),
  preservedMounts: [
    ...motor.mountInterfaces.map((item) =>
      placeMountInAssembly(item, motorAssemblyOrigin)),
    ...bodyInterface.mountInterfaces.map((item) =>
      placeMountInAssembly(item, bodyAssemblyOrigin)),
  ],
  obstacleVolumes: [
    ...motor.keepOutVolumes.map((item) =>
      placeVolumeInAssembly(item, motorAssemblyOrigin)),
    ...bodyInterface.keepOutVolumes.map((item) =>
      placeVolumeInAssembly(item, bodyAssemblyOrigin)),
  ],
  accessVolumes: [],
  missingComponents: [],
  incompatibleComponents: [],
  ambiguousComponents: [],
});

const study = await defineStudy({
  id: "drone-arm-foundation-study",
  assemblyRevision: assembly.revision,
  geometryCoordinates: "assembly",
  designRegion: box("arm-design-region", [52.5, 0, 3], [125, 42, 18]),
  voxelResolution: {
    x: { value: 48, unit: "voxels" },
    y: { value: 24, unit: "voxels" },
    z: { value: 24, unit: "voxels" },
  },
  material: {
    id: "pla-foundation-profile",
    youngsModulus: { value: 3500, unit: "MPa" },
    poissonRatio: 0.36,
    density: { value: 1.24, unit: "g/cm^3" },
  },
  manufacturing: {
    process: "fused-filament-fabrication",
    minimumFeature: mm(1.2),
    buildDirection: "z",
  },
  loadCases: [
    {
      id: "maximum-thrust",
      name: "Maximum motor thrust",
      fixedRegions: [box("body-fixed-region", [0, 0, 3], [12, 34, 8])],
      forces: [
        {
          region: cylinder("motor-load-region", [105, 0, 0], 14, 4),
          vector: { x: newtons(0), y: newtons(0), z: newtons(-18) },
        },
      ],
    },
  ],
  objective: { kind: "minimize-compliance", volumeFraction: 0.35 },
  hardLimits: { maximumDisplacement: mm(1.5) },
  deterministicSeed: 2207,
  solverRevision: "foundation-probe-v1",
});

const inventory = defineInventory([
  {
    componentRevision: motor.revision,
    ownedQuantity: 1,
    availability: "available",
    label: "Bench motor",
  },
  {
    componentRevision: fastener.revision,
    ownedQuantity: 3,
    availability: "available",
    label: "M3 fastener bin",
  },
  {
    componentRevision: bodyInterface.revision,
    ownedQuantity: 1,
    availability: "available",
    label: "Frame interface",
  },
]);

export const DRONE_ARM_FOUNDATION_STUDY = freezeSnapshot({
  components: [motor, fastener, bodyInterface],
  inventory,
  assembly,
  study,
});

const foundationSelections: Readonly<Record<string, ContextSelection>> = {
  "motor-side-arm-span": {
    id: "motor-side-arm-span", label: "Complete quadrotor frame", min: [0, 0, 0], maxExclusive: [25, 25, 5],
  },
  "cable-clearance": {
    id: "cable-clearance", label: "Cable clearance corridor", min: [3, 11, 2], maxExclusive: [22, 14, 5],
  },
};
export const FOUNDATION_SELECTIONS = freezeSnapshot(foundationSelections);

export const DRONE_ARM_FOUNDATION_CONTEXT = createFoundationContext({
  assembly, inventory, study, selection: FOUNDATION_SELECTIONS["motor-side-arm-span"]!,
});
