export const MIN_PROBE_AXIS = 32;
export const MAX_PROBE_AXIS = 64;
export const PROBE_TOLERANCE = 5e-6;

export interface ProbeDimensions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface ProbeInput {
  readonly dimensions: ProbeDimensions;
  readonly values: Float32Array;
}

type UnknownRecord = Record<PropertyKey, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function validateAxis(value: unknown, axis: keyof ProbeDimensions): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_PROBE_AXIS ||
    value > MAX_PROBE_AXIS
  ) {
    throw new RangeError(
      `dimensions.${axis} must be an integer from ${MIN_PROBE_AXIS} through ${MAX_PROBE_AXIS}`,
    );
  }
}

function f32ProbeValue(value: number): number {
  return Math.fround(Math.fround(value * value) + 0.125);
}

export function validateProbeInput(input: unknown): asserts input is ProbeInput {
  if (!isRecord(input)) {
    throw new TypeError("probe input must be an object");
  }

  const dimensions = input.dimensions;
  if (!isRecord(dimensions)) {
    throw new TypeError("dimensions must be an object");
  }

  validateAxis(dimensions.width, "width");
  validateAxis(dimensions.height, "height");
  validateAxis(dimensions.depth, "depth");

  const values = input.values;
  if (!(values instanceof Float32Array)) {
    throw new TypeError("values must be a Float32Array");
  }

  const count = dimensions.width * dimensions.height * dimensions.depth;
  if (values.length !== count) {
    throw new RangeError(
      `values length must equal dimensions.width * dimensions.height * dimensions.depth (${count})`,
    );
  }

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      throw new RangeError(`values[${index}] must be finite`);
    }
    if (!Number.isFinite(f32ProbeValue(value))) {
      throw new RangeError(`values[${index}] produces a non-finite f32 probe result`);
    }
  }
}

export function expectedProbe(input: ProbeInput): Float32Array {
  validateProbeInput(input);

  const output = new Float32Array(input.values.length);
  for (let index = 0; index < input.values.length; index += 1) {
    output[index] = f32ProbeValue(input.values[index]);
  }
  return output;
}
