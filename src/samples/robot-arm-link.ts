import { createAssemblyAuthoringState } from "../assembly/assembly-authoring";
import {
  defineAssemblyDraft,
  defineComponent,
  defineInventory,
  defineStudy,
  freezeSnapshot,
} from "../domain/design";
import type { ContextSelection } from "../domain/foundation-context";
import { createFoundationContext } from "./foundation-context";

const m = (value: number) => ({ value, unit: "m" as const });
const mm = (value: number) => ({ value, unit: "mm" as const });
const n = (value: number) => ({ value, unit: "N" as const });
const point = (x: number, y: number, z: number) => ({ x: m(x), y: m(y), z: m(z) });
const orientation = {
  roll: { value: 0, unit: "rad" as const },
  pitch: { value: 0, unit: "rad" as const },
  yaw: { value: 0, unit: "rad" as const },
};
const transform = (x: number, y: number, z: number) => ({ position: point(x, y, z), orientation });
const box = (id: string, center: readonly [number, number, number], size: readonly [number, number, number]) => ({
  kind: "box" as const, id, center: point(...center), size: point(...size), orientation,
});
const cylinder = (id: string, center: readonly [number, number, number], radius: number, height: number) => ({
  kind: "cylinder" as const, id, center: point(...center), radius: m(radius), height: m(height), orientation,
});

const provenance = (title: string, property: string, value: number, unit: string) => ({
  mode: "user-defined" as const,
  licence: { status: "redistributable" as const, reference: "sunderlabs:robot-link-fixture:rev-1" },
  uncertainty: [{ property, statement: "Qualified hackathon fixture assumption; verify against the selected production hardware." }],
  sources: [{
    id: "fixture-drawing", classification: "engineering-drawing" as const,
    title, reference: "sunderlabs:robot-link-fixture:rev-1",
    sourceTimestamp: "2026-08-28", accessedOn: "2026-08-28",
    redistribution: "redistributable" as const,
  }],
  sourceObservations: [{ property, value, unit, sourceId: "fixture-drawing" }],
});

const jointInterface = await defineComponent({
  id: "robot-joint-interface-16mm",
  category: "robotics/joint-interface",
  geometryCoordinates: "component-local",
  manufacturer: "Sunderlabs",
  partNumber: "RJ-16-FIXTURE",
  provenance: provenance("Robot joint interface fixture drawing", "outer diameter", 36, "mm"),
  mass: { value: 42, unit: "g" },
  massAccounting: "standalone",
  optimizationRole: "fixed-component",
  centerOfMass: point(0, 0, 0),
  anchor: { id: "joint-axis", coordinates: "component-local", position: point(0, 0, 0) },
  envelope: cylinder("joint-envelope", [0, 0, 0], 0.018, 0.012),
  collisionVolumes: [cylinder("joint-collision", [0, 0, 0], 0.018, 0.012)],
  protectedVolumes: [],
  mountInterfaces: [{
    id: "link-annulus", position: point(0, 0, 0), orientation,
    diameter: m(0.036), fastenerType: "16 mm joint pin",
  }],
  loadContributions: [],
  allowedOrientations: [orientation],
  geometry: {
    kind: "parametric",
    graph: { nodes: [{ kind: "cylinder", id: "joint-body", center: point(0, 0, 0), radius: m(0.018), height: m(0.012), orientation }] },
  },
  interfaces: [{
    kind: "mate", id: "joint-axis", coordinates: "component-local",
    position: point(0, 0, 0), orientation, mating: "concentric", diameter: m(0.016),
  }, {
    kind: "access", id: "joint-pin-access", coordinates: "component-local",
    position: point(0, 0, 0), orientation,
    volume: cylinder("joint-pin-clearance", [0, 0, 0], 0.008, 0.024),
  }],
});

const payload = await defineComponent({
  id: "robot-payload-fixture",
  category: "robotics/payload",
  geometryCoordinates: "component-local",
  manufacturer: "Sunderlabs",
  partNumber: "PAYLOAD-1P5KG",
  provenance: provenance("Robot payload fixture assumption", "payload mass", 1.5, "kg"),
  mass: { value: 1.5, unit: "kg" },
  massAccounting: "standalone",
  optimizationRole: "protected",
  centerOfMass: point(0, 0, 0),
  anchor: { id: "payload-mount", coordinates: "component-local", position: point(0, 0, 0) },
  envelope: box("payload-envelope", [0, 0, 0], [0.05, 0.04, 0.05]),
  collisionVolumes: [box("payload-collision", [0, 0, 0], [0.05, 0.04, 0.05])],
  protectedVolumes: [],
  mountInterfaces: [],
  loadContributions: [],
  allowedOrientations: [orientation],
  geometry: {
    kind: "parametric",
    graph: { nodes: [{ kind: "box", id: "payload-body", center: point(0, 0, 0), size: point(0.05, 0.04, 0.05) }] },
  },
  interfaces: [{
    kind: "mate", id: "payload-mount", coordinates: "component-local",
    position: point(0, 0, 0), orientation, mating: "planar",
  }],
});

const assembly = await defineAssemblyDraft({
  id: "robot-arm-link",
  geometryCoordinates: "assembly",
  components: [
    { instanceId: "base-joint", componentRevision: jointInterface.revision, quantity: 1, transform: transform(0, 0, 0) },
    { instanceId: "payload-joint", componentRevision: jointInterface.revision, quantity: 1, transform: transform(0.12, 0, 0) },
    { instanceId: "payload", componentRevision: payload.revision, quantity: 1, transform: transform(0.12, 0, 0.04) },
  ],
  targetEnvelope: box("robot-link-design-domain", [0.06, 0, 0], [0.16, 0.08, 0.02]),
  preservedMounts: [
    { id: "base-joint-annulus", position: point(0, 0, 0), orientation, diameter: m(0.036), fastenerType: "16 mm joint pin" },
    { id: "payload-joint-annulus", position: point(0.12, 0, 0), orientation, diameter: m(0.036), fastenerType: "16 mm joint pin" },
  ],
  obstacleVolumes: [],
  accessVolumes: [
    cylinder("base-pin-clearance", [0, 0, 0], 0.008, 0.024),
    cylinder("payload-pin-clearance", [0.12, 0, 0], 0.008, 0.024),
  ],
  missingComponents: [], incompatibleComponents: [], ambiguousComponents: [],
});

const study = await defineStudy({
  id: "robot-arm-link-topology",
  assemblyRevision: assembly.revision,
  geometryCoordinates: "assembly",
  designRegion: assembly.targetEnvelope,
  voxelResolution: {
    x: { value: 48, unit: "voxels" }, y: { value: 32, unit: "voxels" }, z: { value: 8, unit: "voxels" },
  },
  material: {
    id: "pa12-qualified-assumption", youngsModulus: { value: 1700, unit: "MPa" },
    failureStress: { value: 45, unit: "MPa" }, poissonRatio: 0.39,
    density: { value: 1.01, unit: "g/cm^3" },
  },
  manufacturing: { process: "fused-filament-fabrication", minimumFeature: mm(2.5), buildDirection: "z" },
  loadCases: [
    {
      id: "payload-down", name: "1.5 kg payload with dynamic amplification",
      fixedRegions: [cylinder("base-support", [0, 0, 0], 0.018, 0.01)],
      forces: [{ region: cylinder("payload-load", [0.12, 0, 0], 0.018, 0.01), vector: { x: n(0), y: n(0), z: n(-120) } }],
    },
    {
      id: "emergency-side", name: "Emergency lateral stop",
      fixedRegions: [cylinder("base-support", [0, 0, 0], 0.018, 0.01)],
      forces: [{ region: cylinder("payload-load", [0.12, 0, 0], 0.018, 0.01), vector: { x: n(0), y: n(60), z: n(0) } }],
    },
  ],
  objective: { kind: "minimize-compliance", volumeFraction: 0.35 },
  hardLimits: { maximumDisplacement: mm(2) },
  deterministicSeed: 1601,
  solverRevision: "sparse-simp-lattice-v2",
});

const inventory = defineInventory([
  { componentRevision: jointInterface.revision, ownedQuantity: 2, availability: "available" },
  { componentRevision: payload.revision, ownedQuantity: 1, availability: "available" },
]);
const workspace = await createAssemblyAuthoringState(assembly, [jointInterface, payload]);
const selection: ContextSelection = {
  id: "robot-link-design-domain", label: "Robot arm link design domain",
  min: [0, 0, 0], maxExclusive: [48, 32, 8],
};
const context = createFoundationContext({ assembly, inventory, study, selection });

export const ROBOT_ARM_LINK_FIXTURE = freezeSnapshot({
  id: "robot-arm-link",
  label: "Robot arm link",
  components: [jointInterface, payload],
  inventory,
  assembly,
  study,
  workspace,
  context,
});
