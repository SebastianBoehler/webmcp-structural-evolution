import { solveAssemblyConstraints, type AssemblyAuthoringState } from "../assembly/assembly-authoring";
import type { StudySpec } from "../domain/design";
import type { AssemblyTopologyInput, LiveTopologyContext, SolverVolume } from "./assembly-topology-input";

type Point = readonly [number, number, number];

const metres = (value: { readonly value: number; readonly unit: "m" | "mm" }) =>
  value.unit === "m" ? value.value : value.value / 1_000;
const point = (value: Readonly<{
  x: { readonly value: number; readonly unit: "m" | "mm" };
  y: { readonly value: number; readonly unit: "m" | "mm" };
  z: { readonly value: number; readonly unit: "m" | "mm" };
}>): Point => [metres(value.x), metres(value.y), metres(value.z)];

function solverVolume(volume: StudySpec["designRegion"]): SolverVolume {
  const yawRad = volume.orientation.yaw.value;
  if (volume.orientation.roll.value !== 0 || volume.orientation.pitch.value !== 0) {
    throw new Error(`Topology study volume must be aligned to assembly z: ${volume.id}`);
  }
  if (volume.kind === "box") return {
    kind: "box", centerM: point(volume.center), sizeM: point(volume.size), yawRad,
  };
  return {
    kind: "cylinder", centerM: point(volume.center), radiusM: metres(volume.radius),
    heightM: metres(volume.height), yawRad,
  };
}

function gridFor(study: StudySpec): AssemblyTopologyInput["grid"] {
  const domain = solverVolume(study.designRegion);
  const dimensions = {
    width: study.voxelResolution.x.value,
    height: study.voxelResolution.y.value,
    depth: study.voxelResolution.z.value,
  };
  const size: Point = domain.kind === "box"
    ? domain.sizeM!
    : [domain.radiusM! * 2, domain.radiusM! * 2, domain.heightM!];
  const axisDimensions = [dimensions.width, dimensions.height, dimensions.depth] as const;
  return {
    dimensions,
    originM: domain.centerM.map((value, axis) => value - size[axis]! / 2) as unknown as Point,
    cellSizeM: size.map((value, axis) => value / axisDimensions[axis]!) as unknown as Point,
  };
}

function rotate([x, y, z]: Point, [roll, pitch, yaw]: readonly [number, number, number]): Point {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [
    cy * cp * x + (cy * sp * sr - sy * cr) * y + (cy * sp * cr + sy * sr) * z,
    sy * cp * x + (sy * sp * sr + cy * cr) * y + (sy * sp * cr - cy * sr) * z,
    -sp * x + cp * sr * y + cp * cr * z,
  ];
}

function massProperties(state: AssemblyAuthoringState) {
  const solved = solveAssemblyConstraints(state);
  const weighted = [0, 0, 0];
  let assemblyMassKg = 0;
  for (const instance of state.draft.components) {
    const definition = state.catalog.find(({ revision }) => revision === instance.componentRevision);
    const transform = solved.instances[instance.instanceId]?.transform;
    if (!definition || !transform) throw new Error(`Assembly instance cannot be resolved: ${instance.instanceId}`);
    if (definition.massAccounting !== "standalone") continue;
    const massKg = definition.mass.value * instance.quantity;
    const localCenter = point(definition.centerOfMass);
    const anchor = point(definition.anchor.position);
    const local = rotate(localCenter.map((value, axis) => value - anchor[axis]!) as unknown as Point, transform.orientationRad);
    const centerM = transform.positionMm.map((value, axis) => value / 1_000 + local[axis]!) as unknown as Point;
    assemblyMassKg += massKg;
    for (let axis = 0; axis < 3; axis += 1) weighted[axis] += centerM[axis]! * massKg;
  }
  if (assemblyMassKg <= 0) throw new Error("Topology study assembly must have positive accounted mass.");
  return {
    assemblyMassKg,
    centerOfMassM: weighted.map((value) => value / assemblyMassKg) as unknown as Point,
  };
}

function supportsFor(study: StudySpec): readonly SolverVolume[] {
  const cases = study.loadCases.map(({ fixedRegions }) => fixedRegions.map(solverVolume));
  const canonical = JSON.stringify(cases[0]);
  if (cases.some((supports) => JSON.stringify(supports) !== canonical)) {
    throw new Error("The lattice adapter requires identical support regions in every load case.");
  }
  return cases[0]!;
}

export function compileAssemblyTopologyContext(
  state: AssemblyAuthoringState,
  study: StudySpec,
): LiveTopologyContext {
  if (study.assemblyRevision !== state.draft.revision) {
    throw new Error("Topology study assembly revision does not match the live assembly.");
  }
  const grid = gridFor(study);
  const mass = massProperties(state);
  const input: AssemblyTopologyInput = {
    grid,
    designDomain: [solverVolume(study.designRegion)],
    loadCases: study.loadCases.map((loadCase) => ({
      id: loadCase.id,
      loads: loadCase.forces.map(({ region, vector }) => ({
        region: solverVolume(region), forceN: [vector.x.value, vector.y.value, vector.z.value],
      })),
    })),
    motorMounts: [],
    supports: supportsFor(study),
    requiredSolids: [],
    protectedVoids: state.draft.obstacleVolumes.map(solverVolume),
    accessVoids: state.draft.accessVolumes.map(solverVolume),
    loadPathGuides: [],
    material: {
      youngsModulusPa: study.material.youngsModulus.value,
      failureStressPa: study.material.failureStress.value,
    },
    minimumFeatureM: study.manufacturing.minimumFeature.value,
    minimumLoadPathWidthM: study.manufacturing.minimumFeature.value,
    minimumFrameThicknessM: study.manufacturing.minimumFeature.value,
    inertialRelief: false,
    ...mass,
    inertialMasses: [],
  };
  return {
    input,
    grid: {
      dimensions: grid.dimensions,
      cellSize: grid.cellSizeM.map((value) => value * 1_000) as unknown as Point,
      anchor: {
        position: grid.originM.map((value) => value * 1_000) as unknown as Point,
        orientation: [0, 0, 0, 1],
      },
    },
  };
}
