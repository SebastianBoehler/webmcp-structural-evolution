export function topologyMask(
  density: Float32Array,
  isoValue: number,
  designDomain: Uint32Array,
): Uint32Array {
  if (designDomain.length !== density.length) throw new Error("Topology design domain length is invalid");
  return Uint32Array.from(density, (value, index) => Number(designDomain[index] === 1 && value >= isoValue));
}

export function topologyDiscreteLimits(
  targetVolumeFraction: number,
  moveLimit: number,
  designDomain: Uint32Array,
  required: ReadonlySet<number>,
  protectedCells: ReadonlySet<number>,
): Readonly<{ domainCount: number; targetCount: number; moveBudget: number }> {
  const domainCount = designDomain.reduce((sum, value) => sum + value, 0);
  if (designDomain.some((value) => value !== 0 && value !== 1)
    || !Number.isFinite(targetVolumeFraction) || targetVolumeFraction <= 0 || targetVolumeFraction > 1
    || !Number.isFinite(moveLimit) || moveLimit <= 0 || moveLimit > 1) {
    throw new Error("Topology discrete constraints are invalid");
  }
  if ([...required, ...protectedCells].some((cell) => designDomain[cell] !== 1)) {
    throw new Error("Topology passive constraint lies outside the canonical design domain");
  }
  const targetCount = Math.round(targetVolumeFraction * domainCount);
  if (targetCount < required.size || targetCount > domainCount - protectedCells.size) {
    throw new Error("Topology target volume cannot satisfy revision-owned passive constraints");
  }
  return { domainCount, targetCount, moveBudget: Math.floor(moveLimit * domainCount) };
}

export function assertTopologyScheduleFeasible(
  baseline: Uint32Array,
  maxIterations: number,
  targetVolumeFraction: number,
  moveLimit: number,
  required: ReadonlySet<number>,
  protectedCells: ReadonlySet<number>,
  designDomain: Uint32Array,
): void {
  const { targetCount, moveBudget } = topologyDiscreteLimits(
    targetVolumeFraction, moveLimit, designDomain, required, protectedCells,
  );
  if (baseline.length !== designDomain.length || !Number.isInteger(maxIterations) || maxIterations < 1
    || baseline.some((value, cell) => value !== 0 && value !== 1
      || value === 1 && designDomain[cell] !== 1)
    || [...required].some((cell) => baseline[cell] !== 1)
    || [...protectedCells].some((cell) => baseline[cell] !== 0)) {
    throw new Error("Topology baseline mask violates revision-owned constraints");
  }
  const baselineCount = baseline.reduce((sum, value) => sum + value, 0);
  if (baselineCount < targetCount) throw new Error("Topology baseline material is below the rounded target volume");
  if (baselineCount - targetCount > maxIterations * moveBudget) {
    throw new Error("Topology discrete move budget cannot reach the rounded target volume");
  }
}

export function projectTopologyAnalysisDensity(
  candidate: Float32Array,
  previousMask: Uint8Array,
  isoValue: number,
  targetVolumeFraction: number,
  moveLimit: number,
  required: ReadonlySet<number>,
  protectedCells: ReadonlySet<number>,
  designDomain: Uint32Array,
): Float32Array {
  if (candidate.length !== previousMask.length || candidate.length !== designDomain.length
    || candidate.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || previousMask.some((value, cell) => value !== 0 && value !== 1
      || value === 1 && designDomain[cell] !== 1)) {
    throw new Error("Topology discrete density projection input is invalid");
  }
  const { targetCount, moveBudget } = topologyDiscreteLimits(
    targetVolumeFraction, moveLimit, designDomain, required, protectedCells,
  );
  const previousCount = previousMask.reduce((sum, value) => sum + value, 0);
  if (previousCount < targetCount) {
    throw new Error("Topology baseline material count is below the configured target volume");
  }
  const removable = [...candidate.keys()].filter((cell) => previousMask[cell] === 1
    && !required.has(cell) && !protectedCells.has(cell))
    .sort((left, right) => candidate[left]! - candidate[right]! || left - right);
  const removeCount = Math.min(moveBudget, previousCount - targetCount, removable.length);
  const removed = new Set(removable.slice(0, removeCount));
  const belowIso = Math.fround(isoValue * (1 - 1e-6));
  const output = new Float32Array(candidate.length);
  for (let cell = 0; cell < output.length; cell += 1) {
    if (designDomain[cell] === 0 || protectedCells.has(cell)) output[cell] = 0;
    else if (required.has(cell)) output[cell] = 1;
    else if (removed.has(cell)) output[cell] = Math.min(belowIso, candidate[cell]!);
    else if (previousMask[cell] === 1) output[cell] = Math.max(isoValue, candidate[cell]!);
    else output[cell] = Math.min(belowIso, candidate[cell]!);
  }
  return output;
}

export function projectTopologyDensity(
  candidate: Float32Array,
  previous: Float32Array,
  targetVolumeFraction: number,
  moveLimit: number,
  required: ReadonlySet<number>,
  protectedCells: ReadonlySet<number>,
  designDomain: Uint32Array,
): Float32Array {
  if (candidate.length !== previous.length || designDomain.length !== candidate.length
    || designDomain.some((value) => value !== 0 && value !== 1)
    || candidate.some((value) => !Number.isFinite(value))) {
    throw new Error("Topology density update is invalid");
  }
  const output = new Float32Array(candidate.length);
  for (let index = 0; index < output.length; index += 1) {
    if (designDomain[index] === 0) output[index] = 0;
    else if (required.has(index)) output[index] = 1;
    else if (protectedCells.has(index)) output[index] = 0;
    else output[index] = Math.max(0, previous[index]! - moveLimit,
      Math.min(1, previous[index]! + moveLimit, candidate[index]!));
  }
  if ([...required].some((index) => designDomain[index] !== 1)) {
    throw new Error("Topology required interface lies outside the canonical design domain");
  }
  const domainCount = designDomain.reduce((sum, value) => sum + value, 0);
  const targetTotal = targetVolumeFraction * domainCount;
  if (required.size > targetTotal + 1e-6) {
    throw new Error("Topology target volume cannot preserve every required interface cell");
  }
  const design = [...output.keys()].filter((index) => designDomain[index] === 1
    && !required.has(index) && !protectedCells.has(index));
  const fixedTotal = required.size;
  const allowance = Math.max(0, targetTotal - fixedTotal);
  const designTotal = design.reduce((sum, index) => sum + output[index]!, 0);
  if (designTotal > allowance) {
    let lower = 0, upper = 1;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const scale = (lower + upper) / 2;
      const sum = design.reduce((total, index) => total + Math.max(
        0, previous[index]! - moveLimit, output[index]! * scale,
      ), 0);
      if (sum > allowance) upper = scale;
      else lower = scale;
    }
    for (const index of design) output[index] = Math.fround(Math.max(
      0, previous[index]! - moveLimit, output[index]! * lower,
    ));
  }
  if (output.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Topology density projection left the [0,1] envelope");
  }
  return output;
}
