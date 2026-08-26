type ReferenceModule = typeof import("./pkg/webmcp_reference.js");

let referencePromise: Promise<ReferenceModule> | undefined;

function loadReference(): Promise<ReferenceModule> {
  referencePromise ??= import("./pkg/webmcp_reference.js").then(async (reference) => {
    await reference.default();
    return reference;
  });
  return referencePromise;
}

function requireFloat32Array(value: unknown, name: string): asserts value is Float32Array {
  if (!(value instanceof Float32Array)) {
    throw new TypeError(`${name} must be a Float32Array`);
  }
}

export async function relativeL2(
  expected: Float32Array,
  actual: Float32Array,
): Promise<number> {
  requireFloat32Array(expected, "expected");
  requireFloat32Array(actual, "actual");

  const reference = await loadReference();
  return reference.relative_l2(expected, actual);
}

export type TopologyPreset = "lightweight" | "balanced" | "stiffness";

export interface TopologyOptimizationResult {
  readonly dimensions: { readonly width: number; readonly height: number; readonly depth: number };
  readonly density: Float32Array;
  readonly metrics: {
    readonly initialCompliance: number;
    readonly finalCompliance: number;
    readonly maxDisplacement: number;
    readonly materialFraction: number;
    readonly iterations: number;
  };
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export async function optimizeDroneFrame(
  preset: TopologyPreset,
): Promise<TopologyOptimizationResult> {
  const reference = await loadReference();
  const result = reference.optimize_demo_frame(preset);
  const dimensions = { width: result.width, height: result.height, depth: result.depth };
  const density = result.density;
  const metrics = {
    initialCompliance: result.initial_compliance,
    finalCompliance: result.final_compliance,
    maxDisplacement: result.max_displacement,
    materialFraction: result.material_fraction,
    iterations: result.iterations,
  };
  const expectedLength = dimensions.width * dimensions.height * dimensions.depth;
  const validDimensions = Object.values(dimensions).every(
    (value) => Number.isInteger(value) && value > 0,
  );
  const validMetrics = Object.values(metrics).every(finite);
  const validDensity = density instanceof Float32Array
    && density.length === expectedLength
    && density.every((value) => finite(value) && value >= 0 && value <= 1);
  if (!validDimensions || !validMetrics || !validDensity) {
    throw new Error("Invalid topology result returned by the Wasm solver.");
  }
  return { dimensions, density: new Float32Array(density), metrics };
}
