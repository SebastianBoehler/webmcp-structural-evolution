import type { RequiredTopologyInterface } from "./topology-contract";
import {
  topologyMinimumFeatureOffenders, type TopologyCellDimensions,
} from "./minimum-feature";
import {
  createTopologyMinimumFeatureLocalTracker, type TopologyMinimumFeatureLocalTracker,
} from "./minimum-feature-local";

export interface ManufacturingProjectionConstraints {
  readonly dimensions: TopologyCellDimensions;
  readonly minimumFeatureM: number;
  readonly cellSizeM: number;
  readonly requiredInterfaces: readonly RequiredTopologyInterface[];
}

interface ProjectionInput extends ManufacturingProjectionConstraints {
  readonly scores: Float32Array;
  readonly previousMask: Uint8Array;
  readonly designDomain: Uint32Array;
  readonly required: ReadonlySet<number>;
  readonly protectedCells: ReadonlySet<number>;
  readonly removalQuota: number;
  readonly moveBudget: number;
}

const MAX_EXCHANGE_CLOSURES = 64;
const MAX_SAFE_ADD_CANDIDATES = 4_096;
const MAX_BACKTRACK_REMOVALS = 8;
const MAX_BACKTRACK_SEEDS = 32;
const MAX_BACKTRACK_STATES = 512;
const count = (mask: Uint8Array) => mask.reduce((sum, value) => sum + value, 0);

function interfacesConnected(
  mask: Uint8Array,
  dimensions: TopologyCellDimensions,
  interfaces: readonly RequiredTopologyInterface[],
): boolean {
  const required = interfaces.flatMap(({ cellIndices }) => [...cellIndices]);
  if (required.length === 0 || required.some((cell) => mask[cell] !== 1)) return false;
  const [width, height, depth] = dimensions, plane = width * height;
  const seen = new Uint8Array(mask.length), queue = [required[0]!];
  seen[required[0]!] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor]!, z = Math.floor(cell / plane);
    const rest = cell - z * plane, y = Math.floor(rest / width), x = rest - y * width;
    const neighbors = [x > 0 ? cell - 1 : -1, x + 1 < width ? cell + 1 : -1,
      y > 0 ? cell - width : -1, y + 1 < height ? cell + width : -1,
      z > 0 ? cell - plane : -1, z + 1 < depth ? cell + plane : -1];
    for (const next of neighbors) if (next >= 0 && mask[next] === 1 && seen[next] === 0) {
      seen[next] = 1; queue.push(next);
    }
  }
  return required.every((cell) => seen[cell] === 1);
}

function deletionClosure(
  baseline: Uint8Array,
  seeds: readonly number[],
  input: ProjectionInput,
  tracker: TopologyMinimumFeatureLocalTracker,
): Uint8Array | undefined {
  const mask = new Uint8Array(baseline), queued = new Uint8Array(mask.length);
  const queue = [...seeds].sort((left, right) => left - right);
  queue.forEach((cell) => { queued[cell] = 1; });
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor]!;
    if (mask[cell] === 0) continue;
    if (input.required.has(cell)) return undefined;
    mask[cell] = 0;
    for (const offender of tracker.affectedOffenders(mask, cell)) {
      if (input.required.has(offender)) return undefined;
      if (queued[offender] === 0) { queued[offender] = 1; queue.push(offender); }
    }
  }
  return interfacesConnected(mask, input.dimensions, input.requiredInterfaces) ? mask : undefined;
}

function attemptSafeAddExchange(
  current: Uint8Array,
  closure: Uint8Array,
  currentRemoved: number,
  closureRemoved: number,
  input: ProjectionInput,
  tracker: TopologyMinimumFeatureLocalTracker,
): Uint8Array | undefined {
  let additionsNeeded = currentRemoved + closureRemoved - input.removalQuota;
  if (additionsNeeded <= 0 || additionsNeeded > currentRemoved) return undefined;
  const addable = [...current.keys()].filter((cell) => input.previousMask[cell] === 1
    && current[cell] === 0 && closure[cell] === 0)
    .sort((left, right) => input.scores[right]! - input.scores[left]! || left - right)
    .slice(0, MAX_SAFE_ADD_CANDIDATES);
  const exchanged = new Uint8Array(closure);
  for (const cell of addable) {
    exchanged[cell] = 1;
    const safe = !tracker.isOffender(exchanged, cell);
    if (safe) additionsNeeded -= 1;
    else exchanged[cell] = 0;
    if (additionsNeeded === 0) return exchanged;
  }
  return undefined;
}

function assertFinal(
  mask: Uint8Array,
  input: ProjectionInput,
  tracker: TopologyMinimumFeatureLocalTracker,
): void {
  const previousCount = count(input.previousMask), activeCount = count(mask);
  const removed = previousCount - activeCount;
  const changed = [...mask.keys()].filter((cell) => mask[cell] !== input.previousMask[cell]);
  const valid = removed === input.removalQuota && removed <= input.moveBudget
    && mask.every((value, cell) => value === 0 || (input.previousMask[cell] === 1
      && input.designDomain[cell] === 1))
    && [...input.required].every((cell) => mask[cell] === 1)
    && [...input.protectedCells].every((cell) => mask[cell] === 0)
    && interfacesConnected(mask, input.dimensions, input.requiredInterfaces)
    && changed.every((cell) => tracker.affectedOffenders(mask, cell).length === 0);
  if (!valid) throw new Error("Topology manufacturing projection failed its final invariants");
}

function searchSmallClosureFrontier(
  baseline: Uint8Array,
  baselineRemoved: number,
  ranked: readonly number[],
  input: ProjectionInput,
  tracker: TopologyMinimumFeatureLocalTracker,
): Uint8Array | undefined {
  const remaining = input.removalQuota - baselineRemoved;
  if (remaining < 1 || remaining > MAX_BACKTRACK_REMOVALS) return undefined;
  const frontier = ranked.filter((cell) => baseline[cell] === 1).slice(0, MAX_BACKTRACK_SEEDS);
  let explored = 0;
  const visit = (mask: Uint8Array, removed: number, start: number): Uint8Array | undefined => {
    if (removed === input.removalQuota) return mask;
    if (explored >= MAX_BACKTRACK_STATES) return undefined;
    for (let index = start; index < frontier.length; index += 1) {
      if (explored >= MAX_BACKTRACK_STATES) break;
      const seed = frontier[index]!;
      if (mask[seed] === 0) continue;
      explored += 1;
      const closure = deletionClosure(mask, [seed], input, tracker);
      if (!closure) continue;
      const nextRemoved = removed + count(mask) - count(closure);
      if (nextRemoved > input.removalQuota || nextRemoved === removed) continue;
      const result = visit(closure, nextRemoved, index + 1);
      if (result) return result;
    }
    return undefined;
  };
  return visit(new Uint8Array(baseline), baselineRemoved, 0);
}

export function projectManufacturingMask(input: ProjectionInput): Uint8Array {
  const [width, height, depth] = input.dimensions;
  const invalid = input.previousMask.length !== input.scores.length
    || input.previousMask.length !== input.designDomain.length
    || input.previousMask.length !== width * height * depth
    || !Number.isInteger(input.removalQuota) || input.removalQuota < 0
    || !Number.isInteger(input.moveBudget) || input.moveBudget < input.removalQuota
    || input.scores.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || input.previousMask.some((value, cell) => value !== 0 && value !== 1
      || value === 1 && input.designDomain[cell] !== 1)
    || [...input.required].some((cell) => input.previousMask[cell] !== 1)
    || [...input.protectedCells].some((cell) => input.previousMask[cell] !== 0);
  if (invalid) throw new Error("Topology manufacturing projection input is invalid");
  let mask: Uint8Array<ArrayBufferLike> = new Uint8Array(input.previousMask);
  const tracker = createTopologyMinimumFeatureLocalTracker(
    input.dimensions, input.minimumFeatureM, input.cellSizeM, mask.length,
  );
  const initial = topologyMinimumFeatureOffenders(
    mask, input.dimensions, input.minimumFeatureM, input.cellSizeM,
  );
  if (initial.length > 0) {
    const peeled = deletionClosure(mask, [...initial], input, tracker);
    if (!peeled || count(mask) - count(peeled) > input.removalQuota) {
      throw new Error("Topology manufacturing projection cannot peel its initial feature violations");
    }
    mask = peeled;
  }
  let removed = count(input.previousMask) - count(mask), exchangeClosures = 0;
  const ranked = [...input.scores.keys()].filter((cell) => input.previousMask[cell] === 1
    && !input.required.has(cell) && !input.protectedCells.has(cell))
    .sort((left, right) => input.scores[left]! - input.scores[right]! || left - right);
  const searchBaseline = new Uint8Array(mask), baselineRemoved = removed;
  for (const seed of ranked) {
    if (removed === input.removalQuota) break;
    if (mask[seed] === 0) continue;
    const closure = deletionClosure(mask, [seed], input, tracker);
    if (!closure) continue;
    const closureRemoved = count(mask) - count(closure);
    if (removed + closureRemoved <= input.removalQuota) {
      mask = closure; removed += closureRemoved; continue;
    }
    if (exchangeClosures >= MAX_EXCHANGE_CLOSURES) continue;
    exchangeClosures += 1;
    const exchanged = attemptSafeAddExchange(
      mask, closure, removed, closureRemoved, input, tracker,
    );
    if (exchanged) { mask = exchanged; removed = input.removalQuota; break; }
  }
  if (removed !== input.removalQuota) {
    const searched = searchSmallClosureFrontier(
      searchBaseline, baselineRemoved, ranked, input, tracker,
    );
    if (searched) { mask = searched; removed = input.removalQuota; }
  }
  if (removed !== input.removalQuota) {
    throw new Error("Topology manufacturing projection cannot satisfy the exact removal quota");
  }
  assertFinal(mask, input, tracker);
  return mask;
}
