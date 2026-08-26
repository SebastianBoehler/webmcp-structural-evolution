import type { AssemblyDraft } from "../domain/assembly-model";
import type { ComponentDefinition } from "../domain/component-model";
import type { InventoryItem } from "../domain/design";
import { freezeSnapshot } from "../domain/snapshots";

export type AssemblyConflictKind = "collision" | "insufficient-stock" | "tool-access" | "missing-component" | "incompatible-component" | "ambiguous-component";
export interface AssemblyConflict {
  readonly id: string;
  readonly kind: AssemblyConflictKind;
  readonly message: string;
  readonly instanceIds: readonly string[];
}

export function inspectAssemblyConflicts(
  draft: AssemblyDraft,
  catalog: readonly ComponentDefinition[],
  inventory: readonly InventoryItem[],
): readonly AssemblyConflict[] {
  const components = draft.components.map((instance) => ({ instance, component: componentFor(instance.componentRevision, catalog) }));
  const conflicts = [
    ...catalogConflicts(components),
    ...collisionConflicts(components),
    ...stockConflicts(draft, inventory),
    ...accessConflicts(draft, components),
    ...listedConflicts(draft.missingComponents, "missing-component", "Component is missing"),
    ...listedConflicts(draft.incompatibleComponents, "incompatible-component", "Component is incompatible"),
    ...listedConflicts(draft.ambiguousComponents, "ambiguous-component", "Component is ambiguous"),
  ];
  return freezeSnapshot(conflicts.sort(compareConflict));
}

type PositionedComponent = { readonly instance: AssemblyDraft["components"][number]; readonly component: ComponentDefinition | undefined };
type Bounds = { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
type Matrix = readonly [number, number, number, number, number, number, number, number, number];

function catalogConflicts(components: readonly PositionedComponent[]) {
  return components.flatMap(({ instance, component }) => component ? [] : [{
    id: `missing-component:${instance.instanceId}:${instance.componentRevision}`, kind: "missing-component" as const,
    message: `Catalog revision is absent for ${instance.instanceId}: ${instance.componentRevision}`, instanceIds: [instance.instanceId],
  }]);
}

function collisionConflicts(components: readonly PositionedComponent[]) {
  const conflicts: AssemblyConflict[] = [];
  for (let left = 0; left < components.length; left += 1) for (let right = left + 1; right < components.length; right += 1) {
    const first = components[left]!, second = components[right]!;
    if (!first.component || !second.component || intentionalMotorMate(first, second) || !collides(first, second)) continue;
    const [a, b] = [first.instance.instanceId, second.instance.instanceId].sort();
    conflicts.push({ id: `collision:${a}:${b}`, kind: "collision", message: `Collision between ${a} and ${b}`, instanceIds: [a, b] });
  }
  return conflicts;
}

function intentionalMotorMate(left: PositionedComponent, right: PositionedComponent) {
  const motor = left.component?.category === "motor" ? left : right.component?.category === "motor" ? right : undefined;
  const attached = motor === left ? right : left;
  if (!motor || !attached.component || !["propeller", "fastener"].includes(attached.component.category)) return false;
  return attached.instance.instanceId.startsWith(`${motor.instance.instanceId}-`);
}

function stockConflicts(draft: AssemblyDraft, inventory: readonly InventoryItem[]) {
  const required = new Map<string, number>();
  const owned = new Map<string, number>();
  for (const { componentRevision, quantity } of draft.components) required.set(componentRevision, (required.get(componentRevision) ?? 0) + quantity);
  for (const item of inventory) owned.set(item.componentRevision, (owned.get(item.componentRevision) ?? 0) + (item.availability === "available" ? item.ownedQuantity : 0));
  return [...required].flatMap(([revision, quantity]) => quantity > (owned.get(revision) ?? 0) ? [{
    id: `insufficient-stock:${revision}`, kind: "insufficient-stock" as const,
    message: `Stock shortfall of ${quantity - (owned.get(revision) ?? 0)} for ${revision}`,
    instanceIds: draft.components.filter(({ componentRevision }) => componentRevision === revision).map(({ instanceId }) => instanceId).sort(),
  }] : []);
}

function accessConflicts(draft: AssemblyDraft, components: readonly PositionedComponent[]) {
  return draft.accessVolumes.flatMap((access) => {
    const blocker = components.filter(({ instance, component }) => component && component.collisionVolumes
      .some((volume) => overlaps(volumeBounds(access), volumeBounds(volume, instance, component))))
      .sort((left, right) => left.instance.instanceId.localeCompare(right.instance.instanceId))[0];
    return blocker ? [{ id: `tool-access:${access.id}:${blocker.instance.instanceId}`, kind: "tool-access" as const,
      message: `Service access ${access.id} is blocked by ${blocker.instance.instanceId}`, instanceIds: [blocker.instance.instanceId] }] : [];
  });
}

function listedConflicts(ids: readonly string[], kind: Exclude<AssemblyConflictKind, "collision" | "insufficient-stock" | "tool-access">, message: string) {
  return ids.map((id) => ({ id: `${kind}:${id}`, kind, message: `${message}: ${id}`, instanceIds: [] }));
}

function componentFor(revision: string, catalog: readonly ComponentDefinition[]) {
  return catalog.find((component) => component.revision === revision);
}

function collides(left: PositionedComponent, right: PositionedComponent) {
  return left.component!.collisionVolumes.some((leftVolume) => right.component!.collisionVolumes
    .some((rightVolume) => overlaps(
      volumeBounds(leftVolume, left.instance, left.component),
      volumeBounds(rightVolume, right.instance, right.component),
    )));
}

function volumeBounds(
  volume: ComponentDefinition["collisionVolumes"][number] | AssemblyDraft["accessVolumes"][number],
  instance?: AssemblyDraft["components"][number], component?: ComponentDefinition,
): Bounds {
  const center = worldCenter(volume.center, instance, component);
  const matrix = multiply(rotation(instance?.transform.orientation), rotation(volume.orientation));
  const half = volume.kind === "box"
    ? boxHalf([metres(volume.size.x) / 2, metres(volume.size.y) / 2, metres(volume.size.z) / 2], matrix)
    : cylinderHalf(metres(volume.radius), metres(volume.height) / 2, matrix);
  return { min: [center[0] - half[0], center[1] - half[1], center[2] - half[2]], max: [center[0] + half[0], center[1] + half[1], center[2] + half[2]] };
}

function worldCenter(center: { readonly x: { readonly value: number; readonly unit: "m" | "mm" }; readonly y: { readonly value: number; readonly unit: "m" | "mm" }; readonly z: { readonly value: number; readonly unit: "m" | "mm" } }, instance?: AssemblyDraft["components"][number], component?: ComponentDefinition) {
  const position = instance?.transform.position;
  const anchor = component?.anchor.position;
  const local = [metres(center.x) - (anchor ? metres(anchor.x) : 0), metres(center.y) - (anchor ? metres(anchor.y) : 0), metres(center.z) - (anchor ? metres(anchor.z) : 0)] as const;
  const rotated = apply(rotation(instance?.transform.orientation), local);
  return [rotated[0] + (position ? metres(position.x) : 0), rotated[1] + (position ? metres(position.y) : 0), rotated[2] + (position ? metres(position.z) : 0)] as const;
}

function rotation(orientation?: { readonly roll: { readonly value: number }; readonly pitch: { readonly value: number }; readonly yaw: { readonly value: number } }): Matrix {
  const roll = orientation?.roll.value ?? 0, pitch = orientation?.pitch.value ?? 0, yaw = orientation?.yaw.value ?? 0;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, -sp, cp * sr, cp * cr];
}
function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[1] * right[3] + left[2] * right[6], left[0] * right[1] + left[1] * right[4] + left[2] * right[7], left[0] * right[2] + left[1] * right[5] + left[2] * right[8],
    left[3] * right[0] + left[4] * right[3] + left[5] * right[6], left[3] * right[1] + left[4] * right[4] + left[5] * right[7], left[3] * right[2] + left[4] * right[5] + left[5] * right[8],
    left[6] * right[0] + left[7] * right[3] + left[8] * right[6], left[6] * right[1] + left[7] * right[4] + left[8] * right[7], left[6] * right[2] + left[7] * right[5] + left[8] * right[8],
  ];
}
function apply(matrix: Matrix, [x, y, z]: readonly [number, number, number]) {
  return [matrix[0] * x + matrix[1] * y + matrix[2] * z, matrix[3] * x + matrix[4] * y + matrix[5] * z, matrix[6] * x + matrix[7] * y + matrix[8] * z] as const;
}
function boxHalf([x, y, z]: readonly [number, number, number], matrix: Matrix) {
  return [Math.abs(matrix[0]) * x + Math.abs(matrix[1]) * y + Math.abs(matrix[2]) * z, Math.abs(matrix[3]) * x + Math.abs(matrix[4]) * y + Math.abs(matrix[5]) * z, Math.abs(matrix[6]) * x + Math.abs(matrix[7]) * y + Math.abs(matrix[8]) * z] as const;
}
function cylinderHalf(radius: number, halfHeight: number, matrix: Matrix) {
  return [
    radius * Math.hypot(matrix[0], matrix[1]) + halfHeight * Math.abs(matrix[2]),
    radius * Math.hypot(matrix[3], matrix[4]) + halfHeight * Math.abs(matrix[5]),
    radius * Math.hypot(matrix[6], matrix[7]) + halfHeight * Math.abs(matrix[8]),
  ];
}
function overlaps(left: Bounds, right: Bounds) {
  return left.min[0] < right.max[0] && right.min[0] < left.max[0] && left.min[1] < right.max[1] && right.min[1] < left.max[1] && left.min[2] < right.max[2] && right.min[2] < left.max[2];
}
const metres = (value: { readonly value: number; readonly unit: "m" | "mm" }) => value.unit === "m" ? value.value : value.value / 1_000;
const order: Record<AssemblyConflictKind, number> = { collision: 0, "insufficient-stock": 1, "tool-access": 2, "missing-component": 3, "incompatible-component": 4, "ambiguous-component": 5 };
const compareConflict = (left: AssemblyConflict, right: AssemblyConflict) => order[left.kind] - order[right.kind] || left.id.localeCompare(right.id);
