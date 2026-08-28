import {
  defineAssemblyDraft,
  defineInventory,
  defineStudy,
  freezeSnapshot,
} from "../domain/design";
import type { ContextSelection } from "../domain/foundation-context";
import {
  referenceAssemblyInstance,
  referenceAssemblyWorldMounts,
  referenceWorldVolumesFor,
} from "./reference-drone-assembly";
import { referenceComponent } from "./reference-drone-catalog";
import { createFoundationContext } from "./foundation-context";

const m = (value: number) => ({ value, unit: "m" as const });
const mm = (value: number) => ({ value, unit: "mm" as const });
const newtons = (value: number) => ({ value, unit: "N" as const });
const point = (x: number, y: number, z: number) => ({ x: m(x), y: m(y), z: m(z) });
const orientation = {
  roll: { value: 0, unit: "rad" as const },
  pitch: { value: 0, unit: "rad" as const },
  yaw: { value: 0, unit: "rad" as const },
};
const box = (id: string, center: readonly [number, number, number], size: readonly [number, number, number]) => ({
  kind: "box" as const, id, center: point(...center), size: point(...size), orientation,
});
const cylinder = (id: string, center: readonly [number, number, number], radius: number, height: number) => ({
  kind: "cylinder" as const, id, center: point(...center), radius: m(radius), height: m(height), orientation,
});

const motor = referenceComponent("motor-2207");
const fastener = referenceComponent("fastener-m3x8");
const propeller = referenceComponent("propeller-5x4.3x3");
const bodyInterface = referenceComponent("body-interface");
const selectedInstances = [
  referenceAssemblyInstance("motor-east"),
  referenceAssemblyInstance("motor-east-fastener-1"),
  referenceAssemblyInstance("motor-east-fastener-2"),
  referenceAssemblyInstance("motor-east-fastener-3"),
  referenceAssemblyInstance("motor-east-fastener-4"),
  referenceAssemblyInstance("motor-east-propeller"),
  referenceAssemblyInstance("body-interface"),
];

const assembly = await defineAssemblyDraft({
  id: "drone-arm-foundation",
  geometryCoordinates: "assembly",
  components: selectedInstances,
  targetEnvelope: box("arm-target-envelope", [0.0525, 0, 0.003], [0.125, 0.042, 0.018]),
  preservedMounts: referenceAssemblyWorldMounts(selectedInstances),
  obstacleVolumes: referenceWorldVolumesFor(selectedInstances, "protectedVolumes"),
  accessVolumes: [],
  missingComponents: [],
  incompatibleComponents: [],
  ambiguousComponents: [],
});

const motorInstance = referenceAssemblyInstance("motor-east");
const motorAnchor = motorInstance.transform.position;
const loadForce = motor.loadContributions[0]?.force;
if (!loadForce) throw new Error("Reference motor thrust load is missing");
const study = await defineStudy({
  id: "drone-arm-foundation-study",
  assemblyRevision: assembly.revision,
  geometryCoordinates: "assembly",
  designRegion: box("arm-design-region", [0.0525, 0, 0.003], [0.125, 0.042, 0.018]),
  voxelResolution: {
    x: { value: 48, unit: "voxels" },
    y: { value: 24, unit: "voxels" },
    z: { value: 24, unit: "voxels" },
  },
  material: {
    id: "pla-foundation-profile",
    youngsModulus: { value: 3500, unit: "MPa" },
    failureStress: { value: 50, unit: "MPa" },
    poissonRatio: 0.36,
    density: { value: 1.24, unit: "g/cm^3" },
  },
  manufacturing: {
    process: "fused-filament-fabrication",
    minimumFeature: mm(1.2),
    buildDirection: "z",
  },
  loadCases: [{
    id: "maximum-thrust",
    name: "Maximum motor thrust",
    fixedRegions: [box("body-fixed-region", [0, 0, 0.003], [0.012, 0.034, 0.008])],
    forces: [{
      region: cylinder("motor-load-region", [motorAnchor.x.value, motorAnchor.y.value, motorAnchor.z.value], 0.014, 0.004),
      vector: { x: newtons(loadForce.x.value), y: newtons(loadForce.y.value), z: newtons(loadForce.z.value) },
    }],
  }],
  objective: { kind: "minimize-compliance", volumeFraction: 0.35 },
  hardLimits: { maximumDisplacement: mm(1.5) },
  deterministicSeed: 2207,
  solverRevision: "foundation-probe-v1",
});

const inventory = defineInventory([
  { componentRevision: motor.revision, ownedQuantity: 1, availability: "available", label: "Bench motor" },
  { componentRevision: fastener.revision, ownedQuantity: 3, availability: "available", label: "M3 fastener bin" },
  { componentRevision: propeller.revision, ownedQuantity: 1, availability: "available", label: "Bench propeller" },
  { componentRevision: bodyInterface.revision, ownedQuantity: 1, availability: "available", label: "Frame interface" },
]);

export const DRONE_ARM_FOUNDATION_STUDY = freezeSnapshot({
  components: [motor, fastener, propeller, bodyInterface],
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
