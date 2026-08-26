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

function collisionConflicts(components: readonly PositionedComponent[]) {
  const conflicts: AssemblyConflict[] = [];
  for (let left = 0; left < components.length; left += 1) for (let right = left + 1; right < components.length; right += 1) {
    const first = components[left]!, second = components[right]!;
    if (!first.component || !second.component || !collides(first, second)) continue;
    const [a, b] = [first.instance.instanceId, second.instance.instanceId].sort();
    conflicts.push({ id: `collision:${a}:${b}`, kind: "collision", message: `Collision between ${a} and ${b}`, instanceIds: [a, b] });
  }
  return conflicts;
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
  const yaw = volume.orientation.yaw.value + (instance?.transform.orientation.yaw.value ?? 0);
  const half = volume.kind === "box"
    ? rotatedBoxHalf([metres(volume.size.x) / 2, metres(volume.size.y) / 2, metres(volume.size.z) / 2], yaw)
    : [metres(volume.radius), metres(volume.radius), metres(volume.height) / 2] as const;
  return { min: [center[0] - half[0], center[1] - half[1], center[2] - half[2]], max: [center[0] + half[0], center[1] + half[1], center[2] + half[2]] };
}

function worldCenter(center: { readonly x: { readonly value: number; readonly unit: "m" | "mm" }; readonly y: { readonly value: number; readonly unit: "m" | "mm" }; readonly z: { readonly value: number; readonly unit: "m" | "mm" } }, instance?: AssemblyDraft["components"][number], component?: ComponentDefinition) {
  const position = instance?.transform.position;
  const anchor = component?.anchor.position;
  const x = metres(center.x) - (anchor ? metres(anchor.x) : 0), y = metres(center.y) - (anchor ? metres(anchor.y) : 0);
  const yaw = instance?.transform.orientation.yaw.value ?? 0;
  return [Math.cos(yaw) * x - Math.sin(yaw) * y + (position ? metres(position.x) : 0), Math.sin(yaw) * x + Math.cos(yaw) * y + (position ? metres(position.y) : 0), metres(center.z) - (anchor ? metres(anchor.z) : 0) + (position ? metres(position.z) : 0)] as const;
}

function rotatedBoxHalf([x, y, z]: readonly [number, number, number], yaw: number) {
  return [Math.abs(Math.cos(yaw)) * x + Math.abs(Math.sin(yaw)) * y, Math.abs(Math.sin(yaw)) * x + Math.abs(Math.cos(yaw)) * y, z] as const;
}
function overlaps(left: Bounds, right: Bounds) {
  return left.min[0] < right.max[0] && right.min[0] < left.max[0] && left.min[1] < right.max[1] && right.min[1] < left.max[1] && left.min[2] < right.max[2] && right.min[2] < left.max[2];
}
const metres = (value: { readonly value: number; readonly unit: "m" | "mm" }) => value.unit === "m" ? value.value : value.value / 1_000;
const order: Record<AssemblyConflictKind, number> = { collision: 0, "insufficient-stock": 1, "tool-access": 2, "missing-component": 3, "incompatible-component": 4, "ambiguous-component": 5 };
const compareConflict = (left: AssemblyConflict, right: AssemblyConflict) => order[left.kind] - order[right.kind] || left.id.localeCompare(right.id);
