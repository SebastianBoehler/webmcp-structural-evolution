import { defineDesignDocument, type DesignDocument } from "../cad/document-schema";
import { applyDirection, rotationFromEuler } from "../cad/rigid-transform";
import type { AssemblyDraft } from "../domain/assembly-model";
import type { ComponentDefinition } from "../domain/component-model";
import { normalizeDensity, normalizeMass, normalizePressure, type DensitySchema, type PressureSchema } from "../domain/engineering-units";
import { revisionId } from "../domain/revisions";
import { freezeSnapshot } from "../domain/snapshots";
import { initialDroneWorkspace } from "../assembly/assembly-workspace-model";
import { compileLiveTopologyContext } from "../optimization/assembly-topology-input";
import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import { referenceAssemblyInstance, referenceComponentForInstance, referenceDroneAssembly } from "../samples/reference-drone-assembly";
import { SE6_INSTANCE_GROUPS, se6Assembly } from "../samples/cobot/cobot-assembly";
import { SE6_CATALOG } from "../samples/cobot/cobot-catalog";
import { SE6_JOINTS, SE6_STAGE_IDS } from "../samples/cobot/cobot-mechanism-geometry";
import { se6Study } from "../samples/cobot/cobot-study";
import type { ComponentCadAuthority, ComponentCadSource } from "./component-cad-authority";
import {
  withDroneComponentStudies, withSe6MechanismStudy, withUpperArmThermalStudy,
} from "./component-study-documents";

type Instance = AssemblyDraft["components"][number];
type InterfaceBinding = Readonly<{ id: string; instanceId: string; interfaceId: string }>;
type StudyMaterial = Readonly<{ id: string; youngsModulus: import("zod").infer<typeof PressureSchema>; failureStress: import("zod").infer<typeof PressureSchema>; poissonRatio: number; density: import("zod").infer<typeof DensitySchema> }>;
type MechanismJoint = typeof SE6_JOINTS[number];
export interface AuthoritativeComponentDocument {
  readonly authority: ComponentCadAuthority;
  readonly source: ComponentCadSource;
  readonly document: DesignDocument;
  readonly componentInstances: readonly string[];
  readonly bodyMassKg: Readonly<Record<string, number>>;
  readonly interfaces: readonly InterfaceBinding[];
  readonly protectedInterfaces: readonly Readonly<{ id: string; mount: unknown }>[];
  readonly supports: readonly Readonly<{ id: string; region: unknown }>[];
  readonly loads: readonly Readonly<{ instanceId: string; interfaceId: string; region: unknown; forceN: readonly number[] }>[];
  readonly stages: Readonly<Record<string, readonly string[]>>;
  readonly joints: readonly MechanismJoint[];
}

const componentIntents = new WeakMap<AuthoritativeComponentDocument, string>();

async function defineAuthoritativeComponent(
  value: AuthoritativeComponentDocument,
): Promise<AuthoritativeComponentDocument> {
  const model = freezeSnapshot(value) as AuthoritativeComponentDocument;
  componentIntents.set(model, await revisionId({
    authority: model.authority, source: model.source, documentRevision: model.document.revision,
    componentInstances: model.componentInstances, bodyMassKg: model.bodyMassKg,
    interfaces: model.interfaces, protectedInterfaces: model.protectedInterfaces,
    supports: model.supports, loads: model.loads, stages: model.stages, joints: model.joints,
  }));
  return model;
}

export function authoritativeComponentIntent(model: AuthoritativeComponentDocument): string {
  const intent = componentIntents.get(model);
  if (!intent) throw new Error("Component planners require an authoritative component intent");
  return intent;
}

const m = (value: number) => ({ value, unit: "m" as const });
const rad = (value: number) => ({ value, unit: "rad" as const });
const zeroTransform = { position: { x: m(0), y: m(0), z: m(0) }, orientation: { roll: rad(0), pitch: rad(0), yaw: rad(0) } };
const ids = (instance: Instance) => ({ frame: `${instance.instanceId}-frame`, sketch: `${instance.instanceId}-sketch`, feature: `${instance.instanceId}-feature`, body: `${instance.instanceId}-body`, component: `${instance.instanceId}-component` });

function centeredExtrusionFrame(instance: Instance, centerZ: number, distanceM: number) {
  const { position, orientation } = instance.transform;
  const rotation = rotationFromEuler(
    orientation.roll.value, orientation.pitch.value, orientation.yaw.value,
  );
  const offset = applyDirection({ rotation }, [0, 0, centerZ - distanceM / 2]);
  return { position: {
    x: m(position.x.value + offset[0]), y: m(position.y.value + offset[1]),
    z: m(position.z.value + offset[2]),
  }, orientation };
}

function definitionFor(catalog: readonly ComponentDefinition[], instance: Instance): ComponentDefinition {
  const definition = catalog.find(({ revision }) => revision === instance.componentRevision);
  if (!definition) throw new Error(`Component definition is unresolved: ${instance.instanceId}`);
  return definition;
}

function point(value: { x: { value: number }; y: { value: number }; z: { value: number } }) {
  return [value.x.value, value.y.value, value.z.value] as const;
}

export function compileQualifiedInterfaces(
  instance: Instance, overrides: Readonly<Record<string, readonly number[]>> = {},
  definition: ComponentDefinition = referenceComponentForInstance(instance),
): InterfaceBinding[] {
  const candidates = [...definition.mountInterfaces.map((entry) => ({ id: entry.id, signature: { kind: "mount", position: point(entry.position), diameter: entry.diameter.value } })),
    ...definition.interfaces.map((entry) => ({ id: entry.id, signature: { kind: entry.kind, position: overrides[entry.id] ?? point(entry.position), ...(entry.kind === "mount" || entry.kind === "mate" ? { diameter: entry.diameter?.value } : {}) } }))];
  const bindings = new Map<string, InterfaceBinding & { signature: unknown }>();
  for (const candidate of candidates) {
    const id = `${instance.instanceId}:${candidate.id}`, existing = bindings.get(id);
    if (existing && JSON.stringify(existing.signature) !== JSON.stringify(candidate.signature)) {
      throw new Error(`Conflicting interface binding: ${id}`);
    }
    bindings.set(id, { id, instanceId: instance.instanceId, interfaceId: candidate.id, signature: candidate.signature });
  }
  return [...bindings.values()].map(({ signature: _signature, ...binding }) => binding);
}

function interfaceBindings(instance: Instance, definition: ComponentDefinition): InterfaceBinding[] {
  return compileQualifiedInterfaces(instance, {}, definition);
}

export function compileMaterial(material: StudyMaterial) {
  const youngsModulus = normalizePressure(material.youngsModulus);
  const failureStress = normalizePressure(material.failureStress);
  const density = normalizeDensity(material.density);
  return { id: material.id, kind: "isotropic" as const, densityKgM3: density.value,
    youngsModulusPa: youngsModulus.value, poissonRatio: material.poissonRatio, failureStressPa: failureStress.value };
}

async function compile(
  id: string, label: string, assembly: AssemblyDraft, catalog: readonly ComponentDefinition[], material?: StudyMaterial,
): Promise<Pick<AuthoritativeComponentDocument, "document" | "componentInstances" | "interfaces" | "bodyMassKg">> {
  const frames: unknown[] = [{ id: "world", label: "World", transform: zeroTransform }];
  const sketches: unknown[] = [], features: unknown[] = [], bodies: unknown[] = [], components: unknown[] = [], instances: unknown[] = [];
  const interfaces: InterfaceBinding[] = [];
  for (const instance of assembly.components) {
    const definition = definitionFor(catalog, instance), names = ids(instance), volume = definition.envelope;
    const distanceM = volume.kind === "box" ? volume.size.z.value : volume.height.value;
    frames.push({ id: names.frame, label: instance.instanceId, parentId: "world",
      transform: centeredExtrusionFrame(instance, volume.center.z.value, distanceM) });
    if (volume.kind === "box") {
      const outline = `${instance.instanceId}-outline`;
      sketches.push({ id: names.sketch, plane: `frame:${names.frame}`, entities: [{ id: outline, kind: "rectangle", centerM: [volume.center.x.value, volume.center.y.value], sizeM: [volume.size.x.value, volume.size.y.value] }], constraints: [{ id: `${instance.instanceId}-width`, kind: "distance", first: { entityId: outline, point: "left" }, second: { entityId: outline, point: "right" }, axis: "x", valueM: volume.size.x.value }, { id: `${instance.instanceId}-height`, kind: "distance", first: { entityId: outline, point: "bottom" }, second: { entityId: outline, point: "top" }, axis: "y", valueM: volume.size.y.value }] });
      features.push({ id: names.feature, kind: "extrude", sketchId: names.sketch, distanceM: volume.size.z.value });
    } else {
      const outline = `${instance.instanceId}-outline`;
      sketches.push({ id: names.sketch, plane: `frame:${names.frame}`, entities: [{ id: outline, kind: "circle", centerM: [volume.center.x.value, volume.center.y.value], radiusM: volume.radius.value }], constraints: [{ id: `${instance.instanceId}-radius`, kind: "radius", entityId: outline, valueM: volume.radius.value }] });
      features.push({ id: names.feature, kind: "extrude", sketchId: names.sketch, distanceM: volume.height.value });
    }
    bodies.push({ id: names.body, featureId: names.feature });
    components.push({ id: names.component, bodyIds: [names.body] });
    instances.push({ id: instance.instanceId, componentId: names.component, frameId: "world" });
    interfaces.push(...interfaceBindings(instance, definition));
  }
  return { document: await defineDesignDocument({
    id, label, schemaVersion: 6, units: { length: "m", angle: "rad", mass: "kg" }, createdBy: { kind: "agent", id: "component-document-compiler" },
    frames, parameters: [], sketches, features, bodies, components, instances, mates: [], namedSelections: [],
    materials: material ? [compileMaterial(material)] : [], studies: [],
  }), componentInstances: assembly.components.map(({ instanceId }) => instanceId), interfaces,
  bodyMassKg: Object.freeze(Object.fromEntries(assembly.components.map((instance) => [
    `${instance.instanceId}-body`, normalizeMass(definitionFor(catalog, instance).mass).value * instance.quantity,
  ]))) };
}

export async function droneMotorSideArmDocument(): Promise<AuthoritativeComponentDocument> {
  const live = compileLiveTopologyContext(initialDroneWorkspace);
  if (live.input.supports.length === 0 || live.input.motorMounts.length !== 4) throw new Error("Live drone topology context is incomplete");
  const rootInstanceIds = new Set(referenceDroneAssembly.components.map(({ instanceId }) => instanceId));
  if (DRONE_ARM_FOUNDATION_STUDY.assembly.components.some(({ instanceId }) => !rootInstanceIds.has(instanceId))) throw new Error("Foundation component is absent from the reference drone assembly");
  const sourceCase = DRONE_ARM_FOUNDATION_STUDY.study.loadCases[0];
  const motorInstance = DRONE_ARM_FOUNDATION_STUDY.assembly.components.find((instance) =>
    definitionFor(DRONE_ARM_FOUNDATION_STUDY.components, instance).category === "motor");
  if (!sourceCase || !motorInstance) throw new Error("Drone foundation support or motor source is unresolved");
  const motor = referenceComponentForInstance(motorInstance), sourceForce = sourceCase.forces[0];
  const load = live.input.motorMounts.find(({ loadN }) => sourceForce
    && loadN.every((value, axis) => value === sourceForce.vector[["x", "y", "z"][axis] as "x"].value));
  const interfaceId = motor.loadContributions[0]?.id;
  if (!sourceForce || !load || !interfaceId) throw new Error("Drone foundation load is unresolved");
  const compiled = await compile("drone-motor-side-arm", "Reference drone motor-side parametric arm", DRONE_ARM_FOUNDATION_STUDY.assembly, DRONE_ARM_FOUNDATION_STUDY.components, DRONE_ARM_FOUNDATION_STUDY.study.material);
  const supports = sourceCase.fixedRegions.map((region) => ({ id: region.id, region }));
  const protectedInterfaces = DRONE_ARM_FOUNDATION_STUDY.assembly.preservedMounts
    .map((mount) => ({ id: mount.id, mount }));
  const loads = [{ instanceId: motorInstance.instanceId, interfaceId,
    region: sourceForce.region, forceN: load.loadN }];
  const bodyInstance = DRONE_ARM_FOUNDATION_STUDY.assembly.components.find((instance) =>
    definitionFor(DRONE_ARM_FOUNDATION_STUDY.components, instance).category === "body-interface");
  if (!bodyInstance) throw new Error("Drone body-interface component is unresolved");
  const document = await withDroneComponentStudies(compiled.document, {
    bodyId: `${bodyInstance.instanceId}-body`, supports, loads, protectedInterfaces,
  });
  return defineAuthoritativeComponent({ authority: "parametric-specification-model", source: { authority: "parametric-specification-model", source: "catalog-dimensions" }, ...compiled, document,
    supports, protectedInterfaces, loads, stages: {}, joints: [] });
}

export async function se6UpperArmDocument(): Promise<AuthoritativeComponentDocument> {
  const instance = se6Assembly.components.find(({ instanceId }) => instanceId === "upper-arm-housing");
  if (!instance) throw new Error("SE-6 upper-arm-housing placement is unresolved");
  const compiled = await compile("se6-upper-arm-housing", "SE-6 parametric upper-arm housing", { ...se6Assembly, components: [instance] }, SE6_CATALOG, se6Study.material);
  const document = await withUpperArmThermalStudy(compiled.document);
  return defineAuthoritativeComponent({ authority: "parametric-specification-model", source: { authority: "parametric-specification-model", source: "catalog-dimensions" }, ...compiled, document, supports: [], protectedInterfaces: [], loads: [], stages: {}, joints: [] });
}

export function assertStagePartition(stages: Readonly<Record<string, readonly string[]>>, componentInstances: readonly string[]): void {
  const expected = new Set(componentInstances), seen = new Set<string>();
  for (const ids of Object.values(stages)) for (const id of ids) {
    if (!expected.has(id)) throw new Error(`Unknown stage component: ${id}`);
    if (seen.has(id)) throw new Error(`Duplicate stage component: ${id}`);
    seen.add(id);
  }
  if (seen.size !== expected.size) throw new Error("Stage component coverage is incomplete");
}

export function assertRebuiltBodyCoverage(componentInstances: readonly string[], bodyIds: readonly string[]): void {
  const expected = componentInstances.map((id) => `${id}-body`).sort(), actual = [...bodyIds].sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error("Rebuilt body coverage does not match component instances");
  }
}

export async function se6MechanismDocument(): Promise<AuthoritativeComponentDocument> {
  const compiled = await compile("se6-mechanism-components", "SE-6 52-part parametric mechanism", se6Assembly, SE6_CATALOG);
  const movingJ1 = new Set(["j1-turntable", "j1-bearing-ring", "j1-cover"]);
  const members: Record<(typeof SE6_STAGE_IDS)[number], readonly string[]> = {
    base: SE6_INSTANCE_GROUPS.base.filter((id) => !movingJ1.has(id)),
    "axis-1": [...SE6_INSTANCE_GROUPS.base.filter((id) => movingJ1.has(id)),
      ...SE6_INSTANCE_GROUPS.shoulder, "cable-segment-shoulder"],
    "axis-2": [...SE6_INSTANCE_GROUPS.upperArm, "cable-segment-upper"],
    "axis-3": [...SE6_INSTANCE_GROUPS.forearm, "cable-segment-elbow"],
    "axis-4": [...SE6_INSTANCE_GROUPS.wrist.filter((id) => id.startsWith("j4-")),
      "j5-pitch-housing", "cable-segment-wrist"],
    "axis-5": SE6_INSTANCE_GROUPS.wrist.filter((id) =>
      (id.startsWith("j5-") && id !== "j5-pitch-housing") || id === "j6-tool-roll"),
    "axis-6": [...SE6_INSTANCE_GROUPS.wrist.filter((id) =>
      id.startsWith("j6-") && id !== "j6-tool-roll"),
      ...SE6_INSTANCE_GROUPS.tooling, "wrist-strain-relief"],
  };
  const stages = Object.freeze(Object.fromEntries(SE6_STAGE_IDS.map((id) => [id, members[id]])) as Record<string, readonly string[]>);
  assertStagePartition(stages, compiled.componentInstances);
  const document = await withSe6MechanismStudy(compiled.document);
  return defineAuthoritativeComponent({ authority: "parametric-specification-model", source: { authority: "parametric-specification-model", source: "catalog-dimensions" }, ...compiled, document, supports: [], protectedInterfaces: [], loads: [], stages,
    joints: SE6_JOINTS });
}
