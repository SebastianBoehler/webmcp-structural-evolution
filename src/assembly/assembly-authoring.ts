import { type AssemblyDraft, defineAssemblyDraft } from "../domain/assembly-model";
import type { ComponentDefinition } from "../domain/component-model";
import { normalizeVolume, VolumeSchema } from "../domain/engineering-units";
import { revisionId } from "../domain/revisions";
import { freezeSnapshot, type DeepReadonly } from "../domain/snapshots";

export type ComponentInstance = DeepReadonly<AssemblyDraft["components"][number]>;
export type ConstraintKind = "concentric" | "planar" | "axial" | "orientation";
export type ProtectedRegionKind = "preserve" | "keep-out" | "access" | "cable" | "cooling" | "contact" | "load";

export interface InterfaceReference { readonly instanceId: string; readonly interfaceId: string; }
export interface AssemblyConstraint {
  readonly id: string;
  readonly kind: ConstraintKind;
  readonly moving: InterfaceReference;
  readonly fixed: InterfaceReference;
}
export interface ProtectedRegion {
  readonly id: string;
  readonly kind: ProtectedRegionKind;
  readonly volume: AssemblyDraft["targetEnvelope"];
}
export interface AssemblyAuthoringState {
  readonly draft: AssemblyDraft;
  readonly catalog: readonly ComponentDefinition[];
  readonly constraints: readonly AssemblyConstraint[];
  readonly protectedRegions: readonly ProtectedRegion[];
  readonly revision: string;
}
export type AssemblyAction =
  | { readonly kind: "place"; readonly parentRevision: string; readonly instance: ComponentInstance }
  | { readonly kind: "constrain"; readonly parentRevision: string; readonly constraint: AssemblyConstraint }
  | { readonly kind: "protect"; readonly parentRevision: string; readonly region: ProtectedRegion };

export interface SolvedTransform {
  readonly positionMm: readonly [number, number, number];
  readonly orientationRad: readonly [number, number, number];
}
export interface SolvedAssembly {
  readonly instances: Readonly<Record<string, Readonly<{ transform: SolvedTransform }>>>;
  readonly unresolvedDegreesOfFreedom: Readonly<Record<string, readonly string[]>>;
}

export async function createAssemblyAuthoringState(
  draft: AssemblyDraft,
  catalog: readonly ComponentDefinition[],
): Promise<AssemblyAuthoringState> {
  assertCatalogResolves(draft, catalog);
  return freezeState(draft, catalog, [], []);
}

export async function applyAssemblyAction(
  state: AssemblyAuthoringState,
  action: AssemblyAction,
): Promise<AssemblyAuthoringState> {
  if (action.parentRevision !== state.revision) throw new Error("Assembly action parent revision is stale");
  if (action.kind === "place") return place(state, action.instance);
  if (action.kind === "constrain") return constrain(state, action.constraint);
  return protect(state, action.region);
}

export function solveAssemblyConstraints(state: AssemblyAuthoringState): SolvedAssembly {
  const byInstance = new Map(state.draft.components.map((instance) => [instance.instanceId, instance]));
  const transforms = new Map(state.draft.components.map((instance) => [instance.instanceId, cloneTransform(instance)]));
  const dof = new Map(state.draft.components.map(({ instanceId }) => [instanceId, new Set(["x", "y", "z", "roll", "pitch", "yaw"])]));
  for (const constraint of [...state.constraints].sort((left, right) => left.id.localeCompare(right.id))) {
    const moving = byInstance.get(constraint.moving.instanceId);
    const fixed = byInstance.get(constraint.fixed.instanceId);
    if (!moving || !fixed) continue;
    const movingComponent = componentFor(moving, state.catalog);
    const fixedComponent = componentFor(fixed, state.catalog);
    const movingTransform = transforms.get(moving.instanceId)!;
    const fixedTransform = transforms.get(fixed.instanceId)!;
    if (constraint.kind === "concentric" || constraint.kind === "orientation") {
      movingTransform.orientation = [...fixedTransform.orientation] as Vector;
    }
    const target = interfaceWorldPoint(fixedComponent, fixedTransform, constraint.fixed.interfaceId);
    const current = interfaceWorldPoint(movingComponent, movingTransform, constraint.moving.interfaceId);
    movingTransform.position = add(movingTransform.position, subtract(target, current));
    const unresolved = dof.get(moving.instanceId)!;
    for (const degree of constrainedDegrees(constraint.kind)) unresolved.delete(degree);
  }
  const instances = Object.fromEntries([...transforms].sort(([left], [right]) => left.localeCompare(right)).map(([id, transform]) => [id, {
    transform: { positionMm: [toMillimetres(transform.position[0]), toMillimetres(transform.position[1]), toMillimetres(transform.position[2])] as const, orientationRad: transform.orientation },
  }]));
  const unresolvedDegreesOfFreedom = Object.fromEntries([...dof].sort(([left], [right]) => left.localeCompare(right))
    .map(([id, degrees]) => [id, [...degrees]]));
  return freezeSnapshot({ instances, unresolvedDegreesOfFreedom });
}

async function place(state: AssemblyAuthoringState, instance: ComponentInstance) {
  if (state.draft.components.some(({ instanceId }) => instanceId === instance.instanceId)) throw new Error(`Assembly instance already exists: ${instance.instanceId}`);
  if (!state.catalog.some(({ revision }) => revision === instance.componentRevision)) throw new Error("Placed component revision is not staged in the catalog");
  const draft = await reifyDraft(state.draft, { components: [...state.draft.components, instance] });
  return freezeState(draft, state.catalog, state.constraints, state.protectedRegions);
}

async function constrain(state: AssemblyAuthoringState, constraint: AssemblyConstraint) {
  if (state.constraints.some(({ id }) => id === constraint.id)) throw new Error(`Assembly constraint already exists: ${constraint.id}`);
  assertInterface(state, constraint.moving);
  assertInterface(state, constraint.fixed);
  return freezeState(state.draft, state.catalog, [...state.constraints, freezeSnapshot({ ...constraint })], state.protectedRegions);
}

async function protect(state: AssemblyAuthoringState, region: ProtectedRegion) {
  if (state.protectedRegions.some(({ id }) => id === region.id)) throw new Error(`Protected region already exists: ${region.id}`);
  const normalized = freezeSnapshot({ ...region, volume: normalizeVolume(VolumeSchema.parse(region.volume)) });
  const field = normalized.kind === "access" ? "accessVolumes" : "obstacleVolumes";
  const draft = await reifyDraft(state.draft, { [field]: [...state.draft[field], normalized.volume] });
  return freezeState(draft, state.catalog, state.constraints, [...state.protectedRegions, normalized]);
}

async function reifyDraft(draft: AssemblyDraft, changes: Partial<Omit<AssemblyDraft, "revision">>) {
  const { revision: _revision, ...content } = draft;
  return defineAssemblyDraft({ ...content, ...changes });
}

async function freezeState(
  draft: AssemblyDraft,
  catalog: readonly ComponentDefinition[],
  constraints: readonly AssemblyConstraint[],
  protectedRegions: readonly ProtectedRegion[],
): Promise<AssemblyAuthoringState> {
  const revision = await revisionId({
    draftRevision: draft.revision,
    catalogRevisions: catalog.map(({ revision: value }) => value).sort(),
    constraints, protectedRegions,
  });
  return freezeSnapshot({ draft, catalog: [...catalog], constraints: [...constraints], protectedRegions: [...protectedRegions], revision });
}

function assertCatalogResolves(draft: AssemblyDraft, catalog: readonly ComponentDefinition[]) {
  for (const instance of draft.components) componentFor(instance, catalog);
}

function assertInterface(state: AssemblyAuthoringState, reference: InterfaceReference) {
  const instance = state.draft.components.find(({ instanceId }) => instanceId === reference.instanceId);
  if (!instance) throw new Error(`Constraint instance is absent: ${reference.instanceId}`);
  const component = componentFor(instance, state.catalog);
  if (reference.interfaceId !== "anchor" && !component.interfaces.some(({ id }) => id === reference.interfaceId)) {
    throw new Error(`Constraint interface is absent: ${reference.instanceId}/${reference.interfaceId}`);
  }
}

function componentFor(instance: ComponentInstance, catalog: readonly ComponentDefinition[]) {
  const component = catalog.find(({ revision }) => revision === instance.componentRevision);
  if (!component) throw new Error(`Component revision is absent from the catalog: ${instance.componentRevision}`);
  return component;
}

type Vector = [number, number, number];
type MutableTransform = { position: Vector; orientation: Vector };
const metres = (value: { readonly value: number; readonly unit: "m" | "mm" }) => value.unit === "m" ? value.value : value.value / 1_000;
const toMillimetres = (value: number) => Math.round(value * 1_000_000_000_000) / 1_000_000_000;
const add = (left: Vector, right: Vector): Vector => [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
const subtract = (left: Vector, right: Vector): Vector => [left[0] - right[0], left[1] - right[1], left[2] - right[2]];

function cloneTransform(instance: ComponentInstance): MutableTransform {
  const { position, orientation } = instance.transform;
  return { position: [metres(position.x), metres(position.y), metres(position.z)], orientation: [orientation.roll.value, orientation.pitch.value, orientation.yaw.value] };
}

function interfaceWorldPoint(component: ComponentDefinition, transform: MutableTransform, interfaceId: string): Vector {
  const local = interfaceId === "anchor" ? component.anchor.position : component.interfaces.find(({ id }) => id === interfaceId)?.position;
  if (!local) throw new Error(`Component interface is absent: ${component.id}/${interfaceId}`);
  const anchor = component.anchor.position;
  return add(transform.position, rotate([metres(local.x) - metres(anchor.x), metres(local.y) - metres(anchor.y), metres(local.z) - metres(anchor.z)], transform.orientation));
}

function rotate([x, y, z]: Vector, [roll, pitch, yaw]: readonly [number, number, number]): Vector {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [cy * cp * x + (cy * sp * sr - sy * cr) * y + (cy * sp * cr + sy * sr) * z, sy * cp * x + (sy * sp * sr + cy * cr) * y + (sy * sp * cr - cy * sr) * z, -sp * x + cp * sr * y + cp * cr * z];
}

function constrainedDegrees(kind: ConstraintKind) {
  return kind === "concentric" ? ["x", "y", "z", "roll", "pitch", "yaw"]
    : kind === "planar" ? ["z", "roll", "pitch"] : kind === "axial" ? ["x", "y", "roll", "pitch"] : ["roll", "pitch", "yaw"];
}
