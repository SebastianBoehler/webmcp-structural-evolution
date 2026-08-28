import type { AssemblyAuthoringState } from "../assembly/assembly-authoring";
import { solveAssemblyConstraints } from "../assembly/assembly-authoring";
import type { ComponentDefinition } from "../domain/component-model";
import { componentFixtureVolumes, componentMountAccessVoids } from "./assembly-topology-fixtures";
import { referenceDroneStudyFields } from "./reference-drone-study-fields";
import type { AssemblyTopologyInput, LiveTopologyContext, SolverVolume } from "./topology-contract";

export type { AssemblyTopologyInput, LiveTopologyContext, LoadPathGuide, SolverLoad, SolverLoadCase, SolverVolume } from "./topology-contract";

type Point = readonly [number, number, number];
type Tensor3 = readonly [Point, Point, Point];

const metres = (value: { readonly value: number; readonly unit: "m" | "mm" }) => value.unit === "m" ? value.value : value.value / 1_000;
const point = (value: { readonly x: { readonly value: number; readonly unit: "m" | "mm" }; readonly y: { readonly value: number; readonly unit: "m" | "mm" }; readonly z: { readonly value: number; readonly unit: "m" | "mm" } }): Point => [metres(value.x), metres(value.y), metres(value.z)];
const add = (left: Point, right: Point): Point => [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
const rotateZ = ([x, y, z]: Point, yaw: number): Point => [Math.cos(yaw) * x - Math.sin(yaw) * y, Math.sin(yaw) * x + Math.cos(yaw) * y, z];

function definitionFor(state: AssemblyAuthoringState, revision: string): ComponentDefinition {
  const definition = state.catalog.find((candidate) => candidate.revision === revision);
  if (!definition) throw new Error(`Component revision is absent from the live assembly: ${revision}`);
  return definition;
}

function worldVolume(
  volume: ComponentDefinition["protectedVolumes"][number] | ComponentDefinition["collisionVolumes"][number],
  centerM: Point,
  yawRad: number,
): SolverVolume {
  const local = point(volume.center);
  const center = add(centerM, rotateZ(local, yawRad));
  if (volume.kind === "box") return {
    kind: "box", centerM: center, sizeM: point(volume.size), yawRad: yawRad + volume.orientation.yaw.value,
  };
  if (volume.orientation.roll.value !== 0 || volume.orientation.pitch.value !== 0) {
    const diameter = metres(volume.radius) * 2;
    const axisY = Math.abs(Math.abs(volume.orientation.roll.value) - Math.PI / 2) < 1e-9
      && volume.orientation.pitch.value === 0;
    if (!axisY) throw new Error("Topology input supports only z-axis or local y-axis component cylinders.");
    return { kind: "box", centerM: center, sizeM: [diameter, metres(volume.height), diameter], yawRad: yawRad + volume.orientation.yaw.value };
  }
  return {
    kind: "cylinder", centerM: center, radiusM: metres(volume.radius), heightM: metres(volume.height), yawRad: yawRad + volume.orientation.yaw.value,
  };
}

function expanded(volume: SolverVolume, clearanceM: number): SolverVolume {
  if (clearanceM <= 0) return volume;
  if (volume.kind === "box") return {
    ...volume,
    sizeM: volume.sizeM!.map((value) => value + clearanceM * 2) as unknown as Point,
  };
  return {
    ...volume,
    radiusM: volume.radiusM! + clearanceM,
    heightM: volume.heightM! + clearanceM * 2,
  };
}

function componentClearanceM(category: ComponentDefinition["category"]) {
  switch (category) {
    case "wiring": return 0.0015;
    case "avionics": return 0.0015;
    case "motor": return 0.001;
    case "retention": return 0.001;
    case "fastener": return 0.0005;
    case "battery": return 0.003;
    case "propeller": return 0.002;
    case "body-interface": return 0;
    default: throw new Error(`Reference-drone clearance is not defined for category: ${category}`);
  }
}

function collisionClearances(definition: ComponentDefinition, centerM: Point, yawRad: number) {
  const clearanceM = componentClearanceM(definition.category);
  return definition.collisionVolumes.map((volume) => expanded(worldVolume(volume, centerM, yawRad), clearanceM));
}

function retentionAccessVoids(
  definition: ComponentDefinition,
  centerM: Point,
  yawRad: number,
  grid: AssemblyTopologyInput["grid"],
): readonly SolverVolume[] {
  if (definition.category !== "retention") return [];
  const gridDepthM = grid.cellSizeM[2] * grid.dimensions.depth;
  const gridCenterZ = grid.originM[2] + gridDepthM / 2;
  return definition.protectedVolumes
    .filter(({ id }) => id.endsWith("left-clearance") || id.endsWith("right-clearance"))
    .map((volume) => {
      const world = worldVolume(volume, centerM, yawRad);
      if (world.kind !== "box" || !world.sizeM) {
        throw new Error(`Retention pass-through ${volume.id} must be a box.`);
      }
      return {
        ...world,
        centerM: [world.centerM[0], world.centerM[1], gridCenterZ] as Point,
        // Resolve the 3.5 mm physical slot with at least three cells so the
        // conservative voxel boundary cannot bridge a one-cell opening.
        sizeM: [world.sizeM[0], Math.max(world.sizeM[1], grid.cellSizeM[1] * 3), gridDepthM] as Point,
      };
    });
}

function componentInertiaTensor(definition: ComponentDefinition, massKg: number, yawRad: number): Tensor3 {
  const envelope = worldVolume(definition.envelope, [0, 0, 0], yawRad);
  let localX: number;
  let localY: number;
  let localZ: number;
  if (envelope.kind === "box") {
    const [sizeX, sizeY, sizeZ] = envelope.sizeM!;
    localX = massKg * (sizeY ** 2 + sizeZ ** 2) / 12;
    localY = massKg * (sizeX ** 2 + sizeZ ** 2) / 12;
    localZ = massKg * (sizeX ** 2 + sizeY ** 2) / 12;
  } else {
    const radius = envelope.radiusM!;
    const height = envelope.heightM!;
    localX = localY = massKg * (3 * radius ** 2 + height ** 2) / 12;
    localZ = massKg * radius ** 2 / 2;
  }
  const cosine = Math.cos(envelope.yawRad);
  const sine = Math.sin(envelope.yawRad);
  const xx = cosine ** 2 * localX + sine ** 2 * localY;
  const yy = sine ** 2 * localX + cosine ** 2 * localY;
  const xy = cosine * sine * (localX - localY);
  return [[xx, xy, 0], [xy, yy, 0], [0, 0, localZ]];
}

function dynamicGrid(state: AssemblyAuthoringState): AssemblyTopologyInput["grid"] {
  const envelope = state.draft.targetEnvelope;
  if (envelope.kind !== "box") throw new Error("The FPV topology solver requires the live box design envelope.");
  const center = point(envelope.center);
  const size = point(envelope.size);
  // Preserve the 1.875 mm planar detail that controls the visible arm surface,
  // while using 16 layers through the 24 mm design volume. The former 32-layer
  // solve doubled Wasm working memory without adding meaningful planar detail.
  const dimensions = { width: 128, height: 128, depth: 16 };
  const cellSizeM: Point = [size[0] / dimensions.width, size[1] / dimensions.height, size[2] / dimensions.depth];
  const originM: Point = [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2];
  return { dimensions, originM, cellSizeM };
}

export function compileLiveTopologyContext(state: AssemblyAuthoringState): LiveTopologyContext {
  const grid = dynamicGrid(state);
  const solved = solveAssemblyConstraints(state);
  const motorMounts: { centerM: Point; radiusM: number; loadN: Point }[] = [];
  const supports: SolverVolume[] = [];
  const requiredSolids: SolverVolume[] = [];
  const protectedVoids: SolverVolume[] = [];
  const accessVoids: SolverVolume[] = [];
  const boardMountLocations = new Set<string>();
  let assemblyMassKg = 0;
  const weightedCenter = [0, 0, 0];
  const inertialMasses: AssemblyTopologyInput["inertialMasses"][number][] = [];

  for (const instance of state.draft.components) {
    const definition = definitionFor(state, instance.componentRevision);
    const transform = solved.instances[instance.instanceId]?.transform;
    if (!transform) throw new Error(`Live transform is absent for ${instance.instanceId}.`);
    const centerM: Point = [transform.positionMm[0] / 1_000, transform.positionMm[1] / 1_000, transform.positionMm[2] / 1_000];
    const yawRad = transform.orientationRad[2];
    if (definition.massAccounting === "standalone") {
      const localCenter = point(definition.centerOfMass);
      const localAnchor = point(definition.anchor.position);
      const worldCenter = add(centerM, rotateZ([
        localCenter[0] - localAnchor[0],
        localCenter[1] - localAnchor[1],
        localCenter[2] - localAnchor[2],
      ], yawRad));
      assemblyMassKg += definition.mass.value;
      for (let axis = 0; axis < 3; axis += 1) weightedCenter[axis] += worldCenter[axis]! * definition.mass.value;
      inertialMasses.push({
        id: instance.instanceId,
        centerM: worldCenter,
        massKg: definition.mass.value,
        inertiaTensorKgM2: componentInertiaTensor(definition, definition.mass.value, yawRad),
      });
    }
    if (definition.category === "motor") {
      const mountRadiusM = Math.max(...definition.mountInterfaces.map(({ position }) => Math.hypot(metres(position.x), metres(position.y)))) + 0.004;
      const load = definition.loadContributions[0]?.force;
      const plateCenterM: Point = [centerM[0], centerM[1], centerM[2] - 0.003];
      motorMounts.push({
        centerM: plateCenterM, radiusM: mountRadiusM,
        loadN: [load?.x.value ?? 0, load?.y.value ?? 0, load?.z.value ?? -18],
      });
      for (const mount of definition.mountInterfaces) {
        const localCenter = point(mount.position);
        accessVoids.push({
          kind: "cylinder",
          centerM: add(plateCenterM, rotateZ(localCenter, yawRad)),
          // M3 cap-head radius plus 0.5 mm radial installation clearance.
          radiusM: metres(mount.diameter) / 2 + 0.00184,
          heightM: grid.cellSizeM[2] * grid.dimensions.depth,
          yawRad,
        });
      }
      // Motor bodies are kept clear above the mount; their fasteners are imported as real collision geometry below.
      protectedVoids.push(
        ...collisionClearances(definition, centerM, yawRad),
        ...definition.protectedVolumes.map((volume) => worldVolume(volume, centerM, yawRad)),
      );
    } else if (definition.category === "body-interface") {
      // The body interface is the real fixture boundary for this frame slice, rather than an invented centre support.
      supports.push(...definition.collisionVolumes.map((volume) => worldVolume(volume, centerM, yawRad)));
    } else {
      const fixtures = componentFixtureVolumes(definition, centerM, yawRad);
      requiredSolids.push(...fixtures.solids);
      accessVoids.push(...fixtures.access);
      accessVoids.push(...retentionAccessVoids(definition, centerM, yawRad, grid));
      accessVoids.push(...componentMountAccessVoids(definition, centerM, yawRad, grid, boardMountLocations));
      protectedVoids.push(
        ...collisionClearances(definition, centerM, yawRad),
        ...definition.protectedVolumes.map((volume) => worldVolume(volume, centerM, yawRad)),
      );
    }
  }
  if (motorMounts.length !== 4) throw new Error("The FPV reference solve requires exactly four live motor instances.");
  if (supports.length === 0) throw new Error("The FPV reference solve requires a live body-interface support volume.");
  if (assemblyMassKg <= 0) throw new Error("The FPV reference solve requires positive accounted assembly mass.");

  const centerOfMassM = weightedCenter.map((value) => value / assemblyMassKg) as unknown as Point;
  const { designDomain, loadCases, loadPathGuides } = referenceDroneStudyFields(motorMounts, supports[0]!);

  const input: AssemblyTopologyInput = {
    grid,
    designDomain,
    loadCases,
    motorMounts,
    supports,
    requiredSolids,
    protectedVoids,
    accessVoids,
    loadPathGuides,
    material: { youngsModulusPa: 3_500_000_000, failureStressPa: 50_000_000 },
    minimumFeatureM: 0.001,
    minimumLoadPathWidthM: 0.005,
    minimumFrameThicknessM: 0.005,
    inertialRelief: true,
    assemblyMassKg,
    centerOfMassM,
    inertialMasses,
  };
  return {
    input,
    grid: {
      dimensions: grid.dimensions,
      cellSize: grid.cellSizeM.map((value) => value * 1_000) as unknown as Point,
      anchor: { position: grid.originM.map((value) => value * 1_000) as unknown as Point, orientation: [0, 0, 0, 1] },
    },
  };
}
