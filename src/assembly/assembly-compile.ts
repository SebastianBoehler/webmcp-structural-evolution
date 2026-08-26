import type { ComponentDefinition } from "../domain/component-model";
import type { InventoryItem } from "../domain/design";
import type { AssemblyAuthoringState } from "./assembly-authoring";
import { solveAssemblyConstraints } from "./assembly-authoring";
import { inspectAssemblyConflicts } from "./assembly-conflicts";

export interface CompiledAssembly {
  readonly revision: string;
  readonly massKg: number;
  readonly centerOfMassMm: readonly [number, number, number];
  readonly billOfMaterials: readonly {
    readonly componentRevision: string;
    readonly manufacturer: string;
    readonly partNumber: string;
    readonly quantity: number;
  }[];
  readonly protectedRegionIds: readonly string[];
  readonly unresolvedDegreesOfFreedom: Readonly<Record<string, readonly string[]>>;
  readonly conflicts: readonly { readonly id: string; readonly kind: string }[];
}

const metres = (value: { readonly value: number; readonly unit: "m" | "mm" }) =>
  value.unit === "m" ? value.value : value.value / 1_000;
const definitionFor = (revision: string, catalog: readonly ComponentDefinition[]) => {
  const definition = catalog.find((candidate) => candidate.revision === revision);
  if (!definition) throw new Error(`Component revision is absent from the catalog: ${revision}`);
  return definition;
};
const rotate = ([x, y, z]: readonly number[], [roll, pitch, yaw]: readonly number[]) => {
  const cr = Math.cos(roll!), sr = Math.sin(roll!), cp = Math.cos(pitch!), sp = Math.sin(pitch!), cy = Math.cos(yaw!), sy = Math.sin(yaw!);
  return [cy * cp * x! + (cy * sp * sr - sy * cr) * y! + (cy * sp * cr + sy * sr) * z!, sy * cp * x! + (sy * sp * sr + cy * cr) * y! + (sy * sp * cr - cy * sr) * z!, -sp * x! + cp * sr * y! + cp * cr * z!];
};

export function compileAssemblyState(
  state: AssemblyAuthoringState,
  inventory: readonly InventoryItem[],
): CompiledAssembly {
  const solved = solveAssemblyConstraints(state);
  const solvedDraft = {
    ...state.draft,
    components: state.draft.components.map((instance) => {
      const transform = solved.instances[instance.instanceId]!.transform;
      return { ...instance, transform: {
        position: {
          x: { value: transform.positionMm[0] / 1_000, unit: "m" as const },
          y: { value: transform.positionMm[1] / 1_000, unit: "m" as const },
          z: { value: transform.positionMm[2] / 1_000, unit: "m" as const },
        },
        orientation: {
          roll: { value: transform.orientationRad[0], unit: "rad" as const },
          pitch: { value: transform.orientationRad[1], unit: "rad" as const },
          yaw: { value: transform.orientationRad[2], unit: "rad" as const },
        },
      } };
    }),
  };
  const quantities = new Map<string, number>();
  let massKg = 0;
  const weighted = [0, 0, 0];
  for (const instance of state.draft.components) {
    const component = definitionFor(instance.componentRevision, state.catalog);
    quantities.set(component.revision, (quantities.get(component.revision) ?? 0) + instance.quantity);
    if (component.massAccounting === "none") continue;
    const mass = component.mass.value * instance.quantity;
    const position = solved.instances[instance.instanceId]?.transform.positionMm;
    if (!position) throw new Error(`Solved transform is absent: ${instance.instanceId}`);
    const local = rotate([
      metres(component.centerOfMass.x) - metres(component.anchor.position.x),
      metres(component.centerOfMass.y) - metres(component.anchor.position.y),
      metres(component.centerOfMass.z) - metres(component.anchor.position.z),
    ], solved.instances[instance.instanceId]!.transform.orientationRad);
    massKg += mass;
    for (let axis = 0; axis < 3; axis += 1) weighted[axis] += (position[axis]! + local[axis]! * 1_000) * mass;
  }
  const conflicts = [
    ...inspectAssemblyConflicts(solvedDraft, state.catalog, inventory),
    ...solved.constraintConflicts,
  ].map(({ id, kind }) => ({ id, kind }));
  return Object.freeze({
    revision: state.revision,
    massKg,
    centerOfMassMm: Object.freeze((massKg === 0 ? [0, 0, 0] : weighted.map((value) => value / massKg)) as [number, number, number]),
    billOfMaterials: Object.freeze([...quantities].sort(([left], [right]) => left.localeCompare(right)).map(([revision, quantity]) => {
      const component = definitionFor(revision, state.catalog);
      return Object.freeze({ componentRevision: revision, manufacturer: component.manufacturer, partNumber: component.partNumber, quantity });
    })),
    protectedRegionIds: Object.freeze(state.protectedRegions.map(({ id }) => id)),
    unresolvedDegreesOfFreedom: solved.unresolvedDegreesOfFreedom,
    conflicts: Object.freeze(conflicts),
  });
}
