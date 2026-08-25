import {
  defineAssembly,
  defineComponent,
  defineStudy,
  freezeSnapshot,
} from "../domain/design";

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
const transform = (x: number, y: number, z: number) => ({
  position: point(x, y, z),
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

const motor = defineComponent({
  id: "motor-2207",
  revision: "component:motor-2207:rev-1",
  category: "motor",
  manufacturer: "Generic",
  partNumber: "2207-1750KV",
  provenance: { kind: "generic", reference: "2207 motor dimensional profile rev 1" },
  mass: { value: 34, unit: "g" },
  centerOfMass: point(0, 0, 8.5),
  envelope: cylinder("motor-envelope", [0, 0, 8.5], 14, 17),
  mountInterfaces: [
    mount("motor-mount-nw", -8, 8, 0),
    mount("motor-mount-ne", 8, 8, 0),
    mount("motor-mount-se", 8, -8, 0),
    mount("motor-mount-sw", -8, -8, 0),
  ],
  keepOutVolumes: [cylinder("propeller-keep-out", [0, 0, 24], 65, 10)],
  loadContributions: [
    {
      id: "motor-thrust-load",
      force: { x: newtons(0), y: newtons(0), z: newtons(-20) },
    },
  ],
  allowedOrientations: [orientation()],
});

const fastener = defineComponent({
  id: "m3-fastener",
  revision: "component:m3-fastener:rev-1",
  category: "fastener",
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

const bodyInterface = defineComponent({
  id: "body-interface",
  revision: "component:body-interface:rev-1",
  category: "body-interface",
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

const assembly = defineAssembly({
  id: "drone-arm-foundation",
  revision: "assembly:drone-arm-foundation:rev-1",
  components: [
    {
      instanceId: "motor",
      componentRevision: motor.revision,
      quantity: 1,
      transform: transform(82, 0, 0),
    },
    {
      instanceId: "motor-fasteners",
      componentRevision: fastener.revision,
      quantity: 4,
      transform: transform(82, 0, 0),
    },
    {
      instanceId: "body-interface",
      componentRevision: bodyInterface.revision,
      quantity: 1,
      transform: transform(0, 0, 0),
    },
  ],
  targetEnvelope: box("arm-target-envelope", [41, 0, 3], [110, 42, 18]),
  preservedMounts: [...motor.mountInterfaces, ...bodyInterface.mountInterfaces],
  obstacleVolumes: [...motor.keepOutVolumes, ...bodyInterface.keepOutVolumes],
  accessVolumes: [],
  missingComponents: [],
  incompatibleComponents: [],
  ambiguousComponents: [],
});

const study = defineStudy({
  id: "drone-arm-foundation-study",
  revision: "study:drone-arm-foundation:rev-1",
  assemblyRevision: assembly.revision,
  designRegion: box("arm-design-region", [41, 0, 3], [110, 42, 18]),
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
          region: cylinder("motor-load-region", [82, 0, 0], 14, 4),
          vector: { x: newtons(0), y: newtons(0), z: newtons(-20) },
        },
      ],
    },
  ],
  objective: { kind: "minimize-compliance", volumeFraction: 0.35 },
  hardLimits: { maximumDisplacement: mm(1.5) },
  deterministicSeed: 2207,
  solverRevision: "foundation-probe-v1",
});

export const DRONE_ARM_FOUNDATION_STUDY = freezeSnapshot({
  components: [motor, fastener, bodyInterface],
  inventory: [
    {
      componentRevision: motor.revision,
      ownedQuantity: 1,
      availability: "available" as const,
      label: "Bench motor",
    },
    {
      componentRevision: fastener.revision,
      ownedQuantity: 3,
      availability: "available" as const,
      label: "M3 fastener bin",
    },
    {
      componentRevision: bodyInterface.revision,
      ownedQuantity: 1,
      availability: "available" as const,
      label: "Frame interface",
    },
  ],
  assembly,
  study,
});
