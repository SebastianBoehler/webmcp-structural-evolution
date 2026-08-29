import { defineStudy } from "../../domain/design";
import { SE6_INSTANCE_GROUPS, se6Assembly } from "./cobot-assembly";
import { SE6_CATALOG } from "./cobot-catalog";
import { cylinderVolumeMm, mm } from "./cobot-values";

type Point = readonly [number, number, number];
const metres = (value: { readonly value: number; readonly unit: "m" | "mm" }) =>
  value.unit === "m" ? value.value : value.value / 1_000;
const rotate = ([x, y, z]: Point, [roll, pitch, yaw]: Point): Point => {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [
    cy * cp * x + (cy * sp * sr - sy * cr) * y + (cy * sp * cr + sy * sr) * z,
    sy * cp * x + (sy * sp * sr + cy * cr) * y + (sy * sp * cr - cy * sr) * z,
    -sp * x + cp * sr * y + cp * cr * z,
  ];
};

const distalIds = new Set<string>([
  ...SE6_INSTANCE_GROUPS.forearm,
  ...SE6_INSTANCE_GROUPS.wrist,
  ...SE6_INSTANCE_GROUPS.tooling,
  ...SE6_INSTANCE_GROUPS.services,
]);
let distalMass = 0;
const distalWeighted = [0, 0, 0];
for (const instance of se6Assembly.components.filter(({ instanceId }) => distalIds.has(instanceId))) {
  const definition = SE6_CATALOG.find(({ revision }) => revision === instance.componentRevision);
  if (!definition) throw new Error(`SE-6 distal component is absent: ${instance.instanceId}`);
  const position: Point = [metres(instance.transform.position.x), metres(instance.transform.position.y), metres(instance.transform.position.z)];
  const local: Point = [
    metres(definition.centerOfMass.x) - metres(definition.anchor.position.x),
    metres(definition.centerOfMass.y) - metres(definition.anchor.position.y),
    metres(definition.centerOfMass.z) - metres(definition.anchor.position.z),
  ];
  const orientation: Point = [instance.transform.orientation.roll.value, instance.transform.orientation.pitch.value, instance.transform.orientation.yaw.value];
  const offset = rotate(local, orientation);
  const mass = definition.mass.value * instance.quantity;
  distalMass += mass;
  for (let axis = 0; axis < 3; axis += 1) distalWeighted[axis] += (position[axis]! + offset[axis]!) * mass;
}

export const SE6_DISTAL_MASS_KG = distalMass;
export const SE6_DISTAL_CENTER_M = distalWeighted.map((value) => value / distalMass) as unknown as Point;

const n = (value: number) => ({ value, unit: "N" as const });
const force = (x: number, y: number, z: number) => ({ x: n(x), y: n(y), z: n(z) });
const axisY = [Math.PI / 2, 0, 0] as const;
const support = cylinderVolumeMm("j2-upper-arm-support", 42, 24, [30, 0, 340], axisY);
const loadRegion = cylinderVolumeMm("j3-distal-load", 42, 24, [390, 0, 340], axisY);
const gravityN = SE6_DISTAL_MASS_KG * 9.80665;

export const se6Study = await defineStudy({
  id: "se6-upper-arm-topology", assemblyRevision: se6Assembly.revision,
  geometryCoordinates: "assembly", designRegion: se6Assembly.targetEnvelope,
  voxelResolution: { x: { value: 48, unit: "voxels" }, y: { value: 24, unit: "voxels" }, z: { value: 16, unit: "voxels" } },
  material: {
    id: "pa12-qualified-assumption", youngsModulus: { value: 1700, unit: "MPa" },
    failureStress: { value: 45, unit: "MPa" }, poissonRatio: 0.39,
    density: { value: 1.01, unit: "g/cm^3" },
  },
  manufacturing: { process: "fused-filament-fabrication", minimumFeature: mm(2.5), buildDirection: "z" },
  loadCases: [
    { id: "rated-payload-gravity", name: "Rated payload and distal assembly under gravity", fixedRegions: [support], forces: [{ region: loadRegion, vector: force(0, 0, -gravityN) }] },
    { id: "emergency-stop", name: "Qualified 2 g tangential emergency stop with gravity", fixedRegions: [support], forces: [{ region: loadRegion, vector: force(-2 * gravityN, 0, -gravityN) }] },
    { id: "lateral-disturbance", name: "Qualified 150 N lateral disturbance with gravity", fixedRegions: [support], forces: [{ region: loadRegion, vector: force(0, 150, -gravityN) }] },
  ],
  objective: { kind: "minimize-compliance", volumeFraction: 0.35 },
  hardLimits: { maximumDisplacement: mm(2) }, deterministicSeed: 6006,
  solverRevision: "sparse-simp-lattice-v2",
});
