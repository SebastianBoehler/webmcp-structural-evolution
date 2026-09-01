import { defineDesignDocument, type DesignDocument } from "../cad/document-schema";
import type { AssemblyDraft } from "../domain/assembly-model";
import type { ComponentDefinition } from "../domain/component-model";
import { initialDroneWorkspace } from "../assembly/assembly-workspace-model";
import { compileLiveTopologyContext } from "../optimization/assembly-topology-input";
import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import { referenceDroneAssembly } from "../samples/reference-drone-assembly";
import { SE6_INSTANCE_GROUPS, se6Assembly } from "../samples/cobot/cobot-assembly";
import { SE6_CATALOG } from "../samples/cobot/cobot-catalog";
import { SE6_JOINTS } from "../samples/cobot/cobot-mechanism-geometry";
import { se6Study } from "../samples/cobot/cobot-study";
import type { ComponentCadAuthority, ComponentCadSource } from "./component-cad-authority";

type Instance = AssemblyDraft["components"][number];
type InterfaceBinding = Readonly<{ id: string; instanceId: string; interfaceId: string }>;
export interface AuthoritativeComponentDocument {
  readonly authority: ComponentCadAuthority;
  readonly source: ComponentCadSource;
  readonly document: DesignDocument;
  readonly componentInstances: readonly string[];
  readonly interfaces: readonly InterfaceBinding[];
  readonly protectedInterfaces: readonly string[];
  readonly supports: readonly string[];
  readonly loads: readonly Readonly<{ instanceId: string; interfaceId: string }>[];
  readonly stages: Readonly<Record<string, readonly string[]>>;
  readonly joints: readonly Readonly<{ id: string; kind: "revolute"; first: string; second: string }> [];
}

const m = (value: number) => ({ value, unit: "m" as const });
const rad = (value: number) => ({ value, unit: "rad" as const });
const zeroTransform = { position: { x: m(0), y: m(0), z: m(0) }, orientation: { roll: rad(0), pitch: rad(0), yaw: rad(0) } };
const ids = (instance: Instance) => ({ frame: `${instance.instanceId}-frame`, sketch: `${instance.instanceId}-sketch`, feature: `${instance.instanceId}-feature`, body: `${instance.instanceId}-body`, component: `${instance.instanceId}-component` });

function definitionFor(catalog: readonly ComponentDefinition[], instance: Instance): ComponentDefinition {
  const definition = catalog.find(({ revision }) => revision === instance.componentRevision);
  if (!definition) throw new Error(`Component definition is unresolved: ${instance.instanceId}`);
  return definition;
}

function interfaceBindings(instance: Instance, definition: ComponentDefinition): InterfaceBinding[] {
  return [...definition.mountInterfaces, ...definition.interfaces].map(({ id }) => ({
    id: `${instance.instanceId}:${id}`, instanceId: instance.instanceId, interfaceId: id,
  }));
}

async function compile(
  id: string, label: string, assembly: AssemblyDraft, catalog: readonly ComponentDefinition[], material?: {
    readonly id: string; readonly youngsModulus: { readonly value: number }; readonly failureStress: { readonly value: number };
    readonly poissonRatio: number; readonly density: { readonly value: number; readonly unit: "g/cm^3" | "kg/m^3" };
  },
): Promise<Pick<AuthoritativeComponentDocument, "document" | "componentInstances" | "interfaces">> {
  const frames: unknown[] = [{ id: "world", label: "World", transform: zeroTransform }];
  const sketches: unknown[] = [], features: unknown[] = [], bodies: unknown[] = [], components: unknown[] = [], instances: unknown[] = [];
  const interfaces: InterfaceBinding[] = [];
  for (const instance of assembly.components) {
    const definition = definitionFor(catalog, instance), names = ids(instance), volume = definition.envelope;
    frames.push({ id: names.frame, label: instance.instanceId, parentId: "world", transform: instance.transform });
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
    materials: material ? [{ id: material.id, kind: "isotropic", densityKgM3: material.density.unit === "g/cm^3" ? material.density.value * 1_000 : material.density.value, youngsModulusPa: material.youngsModulus.value * 1e6, poissonRatio: material.poissonRatio, failureStressPa: material.failureStress.value * 1e6 }] : [], studies: [],
  }), componentInstances: assembly.components.map(({ instanceId }) => instanceId), interfaces };
}

export async function droneMotorSideArmDocument(): Promise<AuthoritativeComponentDocument> {
  const live = compileLiveTopologyContext(initialDroneWorkspace);
  if (live.input.supports.length === 0 || live.input.motorMounts.length !== 4) throw new Error("Live drone topology context is incomplete");
  const rootInstanceIds = new Set(referenceDroneAssembly.components.map(({ instanceId }) => instanceId));
  if (DRONE_ARM_FOUNDATION_STUDY.assembly.components.some(({ instanceId }) => !rootInstanceIds.has(instanceId))) throw new Error("Foundation component is absent from the reference drone assembly");
  const compiled = await compile("drone-motor-side-arm", "Reference drone motor-side parametric arm", DRONE_ARM_FOUNDATION_STUDY.assembly, DRONE_ARM_FOUNDATION_STUDY.components, DRONE_ARM_FOUNDATION_STUDY.study.material);
  return { authority: "parametric-specification-model", source: { authority: "parametric-specification-model", source: "catalog-dimensions" }, ...compiled, supports: ["body-interface"],
    protectedInterfaces: DRONE_ARM_FOUNDATION_STUDY.assembly.preservedMounts.map(({ id }) => id),
    loads: [{ instanceId: "motor-east", interfaceId: "motor-thrust-load" }], stages: {}, joints: [] };
}

export async function se6UpperArmDocument(): Promise<AuthoritativeComponentDocument> {
  const instance = se6Assembly.components.find(({ instanceId }) => instanceId === "upper-arm-housing");
  if (!instance) throw new Error("SE-6 upper-arm-housing placement is unresolved");
  const compiled = await compile("se6-upper-arm-housing", "SE-6 parametric upper-arm housing", { ...se6Assembly, components: [instance] }, SE6_CATALOG, se6Study.material);
  return { authority: "parametric-specification-model", source: { authority: "parametric-specification-model", source: "catalog-dimensions" }, ...compiled, supports: ["j2-bearing-interface"], protectedInterfaces: se6Assembly.accessVolumes.map(({ id }) => id), loads: [], stages: {}, joints: [] };
}

export async function se6MechanismDocument(): Promise<AuthoritativeComponentDocument> {
  const compiled = await compile("se6-mechanism-components", "SE-6 52-part parametric mechanism", se6Assembly, SE6_CATALOG);
  const stages = Object.freeze({ base: SE6_INSTANCE_GROUPS.base, "axis-1": [...SE6_INSTANCE_GROUPS.shoulder, "cable-segment-shoulder"], "axis-2": [...SE6_INSTANCE_GROUPS.upperArm, "cable-segment-upper"], "axis-3": [...SE6_INSTANCE_GROUPS.forearm, "cable-segment-elbow"], "axis-4": [...SE6_INSTANCE_GROUPS.wrist.filter((id) => id.startsWith("j4-")), "cable-segment-wrist"], "axis-5": SE6_INSTANCE_GROUPS.wrist.filter((id) => id.startsWith("j5-")), "axis-6": [...SE6_INSTANCE_GROUPS.wrist.filter((id) => id.startsWith("j6-")), ...SE6_INSTANCE_GROUPS.tooling, "wrist-strain-relief"] });
  return { authority: "parametric-specification-model", source: { authority: "parametric-specification-model", source: "catalog-dimensions" }, ...compiled, supports: [], protectedInterfaces: [], loads: [], stages,
    joints: SE6_JOINTS.map(({ id, first, second }) => ({ id, kind: "revolute", first, second })) };
}
