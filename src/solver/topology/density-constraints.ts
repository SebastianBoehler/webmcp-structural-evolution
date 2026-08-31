export function topologyMask(
  density: Float32Array,
  isoValue: number,
  designDomain: Uint32Array,
): Uint32Array {
  if (designDomain.length !== density.length) throw new Error("Topology design domain length is invalid");
  return Uint32Array.from(density, (value, index) => Number(designDomain[index] === 1 && value >= isoValue));
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
