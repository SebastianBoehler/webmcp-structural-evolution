import type { DesignDocument } from "../document-schema";
import { CadRebuildError } from "./rebuild-errors";
import type { ScalarResolver } from "./sketch-geometry";

type Sketch = DesignDocument["sketches"][number];
type Entity = Sketch["entities"][number];
type PointReference = { readonly entityId: string; readonly point: string };
type Point2 = readonly [number, number];

interface ResolvedEntity {
  readonly id: string;
  readonly kind: Entity["kind"];
  readonly offset: number;
  readonly size: number;
}

interface Equation {
  readonly constraintId: string;
  readonly entityIds: readonly string[];
  readonly tolerance: number;
  readonly evaluate: (state: readonly number[]) => number;
}

const LENGTH_TOLERANCE_M = 1e-9;
const ANGLE_TOLERANCE_RAD = 1e-9;
const RANK_TOLERANCE = 1e-7;

function resolveEntity(entity: Entity, state: number[], resolve: ScalarResolver): ResolvedEntity {
  const offset = state.length;
  const length = (value: number | { readonly parameterId: string }, label: string) =>
    resolve(value, "length", label);
  const angle = (value: number | { readonly parameterId: string }, label: string) =>
    resolve(value, "angle", label);
  if (entity.kind === "line") {
    state.push(
      length(entity.startM[0], `${entity.id}.startM[0]`),
      length(entity.startM[1], `${entity.id}.startM[1]`),
      length(entity.endM[0], `${entity.id}.endM[0]`),
      length(entity.endM[1], `${entity.id}.endM[1]`),
    );
  } else if (entity.kind === "arc") {
    state.push(
      length(entity.centerM[0], `${entity.id}.centerM[0]`),
      length(entity.centerM[1], `${entity.id}.centerM[1]`),
      length(entity.radiusM, `${entity.id}.radiusM`),
      angle(entity.startAngleRad, `${entity.id}.startAngleRad`),
      angle(entity.endAngleRad, `${entity.id}.endAngleRad`),
    );
  } else if (entity.kind === "circle") {
    state.push(
      length(entity.centerM[0], `${entity.id}.centerM[0]`),
      length(entity.centerM[1], `${entity.id}.centerM[1]`),
      length(entity.radiusM, `${entity.id}.radiusM`),
    );
  } else {
    state.push(
      length(entity.centerM[0], `${entity.id}.centerM[0]`),
      length(entity.centerM[1], `${entity.id}.centerM[1]`),
      length(entity.sizeM[0], `${entity.id}.sizeM[0]`),
      length(entity.sizeM[1], `${entity.id}.sizeM[1]`),
    );
  }
  return { id: entity.id, kind: entity.kind, offset, size: state.length - offset };
}

function pointFor(reference: PointReference, entities: ReadonlyMap<string, ResolvedEntity>, state: readonly number[]): Point2 {
  const entity = entities.get(reference.entityId)!;
  const at = (index: number) => state[entity.offset + index]!;
  if (entity.kind === "line") return reference.point === "start" ? [at(0), at(1)] : [at(2), at(3)];
  if (entity.kind === "arc") {
    if (reference.point === "center") return [at(0), at(1)];
    const angle = reference.point === "start" ? at(3) : at(4);
    return [at(0) + at(2) * Math.cos(angle), at(1) + at(2) * Math.sin(angle)];
  }
  if (entity.kind === "circle" || reference.point === "center") return [at(0), at(1)];
  if (reference.point === "left") return [at(0) - at(2) / 2, at(1)];
  if (reference.point === "right") return [at(0) + at(2) / 2, at(1)];
  if (reference.point === "bottom") return [at(0), at(1) - at(3) / 2];
  return [at(0), at(1) + at(3) / 2];
}

function equationsFor(sketch: Sketch, entities: ReadonlyMap<string, ResolvedEntity>, resolve: ScalarResolver): Equation[] {
  const equations: Equation[] = [];
  const add = (constraintId: string, entityIds: readonly string[], tolerance: number, evaluate: Equation["evaluate"]) =>
    equations.push({ constraintId, entityIds: [...new Set(entityIds)], tolerance, evaluate });
  for (const constraint of sketch.constraints) {
    if (constraint.kind === "coincident") {
      const ids = [constraint.first.entityId, constraint.second.entityId];
      add(constraint.id, ids, LENGTH_TOLERANCE_M, (state) => pointFor(constraint.first, entities, state)[0] - pointFor(constraint.second, entities, state)[0]);
      add(constraint.id, ids, LENGTH_TOLERANCE_M, (state) => pointFor(constraint.first, entities, state)[1] - pointFor(constraint.second, entities, state)[1]);
    } else if (constraint.kind === "horizontal" || constraint.kind === "vertical") {
      const axis = constraint.kind === "horizontal" ? 1 : 0;
      add(constraint.id, [constraint.entityId], LENGTH_TOLERANCE_M, (state) => {
        const entity = entities.get(constraint.entityId)!;
        return state[entity.offset + axis]! - state[entity.offset + 2 + axis]!;
      });
    } else if (constraint.kind === "distance") {
      const target = resolve(constraint.valueM, "length", `${constraint.id}.valueM`);
      const ids = [constraint.first.entityId, constraint.second.entityId];
      add(constraint.id, ids, LENGTH_TOLERANCE_M, (state) => {
        const first = pointFor(constraint.first, entities, state);
        const second = pointFor(constraint.second, entities, state);
        const dx = second[0] - first[0];
        const dy = second[1] - first[1];
        return (constraint.axis === "x" ? Math.abs(dx) : constraint.axis === "y" ? Math.abs(dy) : Math.hypot(dx, dy)) - target;
      });
    } else if (constraint.kind === "radius") {
      const target = resolve(constraint.valueM, "length", `${constraint.id}.valueM`);
      add(constraint.id, [constraint.entityId], LENGTH_TOLERANCE_M, (state) => {
        const entity = entities.get(constraint.entityId)!;
        return state[entity.offset + 2]! - target;
      });
    } else if (constraint.kind === "angle") {
      const target = resolve(constraint.valueRad, "angle", `${constraint.id}.valueRad`);
      const ids = [constraint.vertex.entityId, constraint.firstDirection.entityId, constraint.secondDirection.entityId];
      add(constraint.id, ids, ANGLE_TOLERANCE_RAD, (state) => {
        const vertex = pointFor(constraint.vertex, entities, state);
        const first = pointFor(constraint.firstDirection, entities, state);
        const second = pointFor(constraint.secondDirection, entities, state);
        const firstVector = [first[0] - vertex[0], first[1] - vertex[1]] as const;
        const secondVector = [second[0] - vertex[0], second[1] - vertex[1]] as const;
        const cross = firstVector[0] * secondVector[1] - firstVector[1] * secondVector[0];
        const dot = firstVector[0] * secondVector[0] + firstVector[1] * secondVector[1];
        return Math.atan2(Math.abs(cross), dot) - target;
      });
    }
  }
  return equations;
}

function matrixRank(matrix: number[][]): number {
  const rows = matrix.map((row) => {
    const scale = Math.max(...row.map(Math.abs), 1);
    return row.map((value) => value / scale);
  });
  let rank = 0;
  for (let column = 0; column < (rows[0]?.length ?? 0) && rank < rows.length; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < rows.length; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(rows[pivot]![column]!) <= RANK_TOLERANCE) continue;
    [rows[rank], rows[pivot]] = [rows[pivot]!, rows[rank]!];
    const divisor = rows[rank]![column]!;
    for (let index = column; index < rows[rank]!.length; index += 1) rows[rank]![index] /= divisor;
    for (let row = 0; row < rows.length; row += 1) if (row !== rank) {
      const factor = rows[row]![column]!;
      for (let index = column; index < rows[row]!.length; index += 1) rows[row]![index] -= factor * rows[rank]![index]!;
    }
    rank += 1;
  }
  return rank;
}

function jacobian(equations: readonly Equation[], state: readonly number[], indexes: readonly number[]): number[][] {
  return equations.map((equation) => indexes.map((stateIndex) => {
    const step = Math.max(1e-8, Math.abs(state[stateIndex]!) * 1e-6);
    const before = [...state];
    const after = [...state];
    before[stateIndex] -= step;
    after[stateIndex] += step;
    return (equation.evaluate(after) - equation.evaluate(before)) / (2 * step);
  }));
}

export function validateResolvedSketchConstraints(sketch: Sketch, resolve: ScalarResolver): void {
  const state: number[] = [];
  const resolved = sketch.entities.map((entity) => resolveEntity(entity, state, resolve));
  const entities = new Map(resolved.map((entity) => [entity.id, entity]));
  const equations = equationsFor(sketch, entities, resolve);
  for (const equation of equations) {
    const residual = equation.evaluate(state);
    if (!Number.isFinite(residual) || Math.abs(residual) > equation.tolerance) {
      throw new CadRebuildError("sketch-constraint-unsatisfied", `Sketch constraint is unsatisfied: ${sketch.id}.${equation.constraintId}`);
    }
  }

  const parent = new Map(resolved.map(({ id }) => [id, id]));
  const root = (id: string): string => parent.get(id) === id ? id : root(parent.get(id)!);
  for (const equation of equations) for (const entityId of equation.entityIds.slice(1)) {
    parent.set(root(entityId), root(equation.entityIds[0]!));
  }
  for (const entity of resolved) parent.set(entity.id, root(entity.id));
  for (const componentId of new Set(parent.values())) {
    const component = resolved.filter(({ id }) => parent.get(id) === componentId);
    const componentIds = new Set(component.map(({ id }) => id));
    const componentEquations = equations.filter(({ entityIds }) => componentIds.has(entityIds[0]!));
    const indexes = component.flatMap(({ offset, size }) => Array.from({ length: size }, (_, index) => offset + index));
    const rank = matrixRank(jacobian(componentEquations, state, indexes));
    const hasDirectionalConstraint = sketch.constraints.some((constraint) =>
      (constraint.kind === "horizontal" || constraint.kind === "vertical")
      && componentIds.has(constraint.entityId));
    const canRotate = !hasDirectionalConstraint
      && !component.some(({ kind }) => kind === "rectangle")
      && component.some(({ kind }) => kind === "line" || kind === "arc");
    const requiredRank = Math.max(0, indexes.length - 2 - (canRotate ? 1 : 0));
    if (componentEquations.length > rank) {
      throw new CadRebuildError("sketch-over-constrained", `Sketch constraints are redundant: ${sketch.id}`);
    }
    if (rank < requiredRank) {
      throw new CadRebuildError("sketch-under-constrained", `Sketch is under-constrained: ${sketch.id}`);
    }
  }
}
