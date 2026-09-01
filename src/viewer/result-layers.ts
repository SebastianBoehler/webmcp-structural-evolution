export type ResultLayer = "topology" | "displacement" | "stress" | "temperature" | "flux" | "mechanism";
export interface FieldGrid {
  readonly dimensions: readonly [number, number, number];
  readonly cellSize: readonly [number, number, number];
  readonly origin: readonly [number, number, number];
  readonly active: Uint8Array;
}
interface ScalarField extends FieldGrid { readonly values: Float32Array; readonly maximum: number }
export interface ResultLayerPayloads {
  readonly topology: FieldGrid & { readonly density: Float32Array };
  readonly displacement: ScalarField & { readonly vectors: Float32Array;
    readonly displacementUnit: "mm"; readonly sourceDisplacementUnit?: "m" | "mm" };
  readonly stress: ScalarField;
  readonly temperature: ScalarField;
  readonly flux: ScalarField & { readonly vectors: Float32Array; readonly vectorUnit: "W/m^2" };
  readonly mechanism: { readonly componentId: string; readonly transform: readonly number[] };
}
export interface ResultLayers {
  set<K extends ResultLayer>(layer: K, payload: ResultLayerPayloads[K] | undefined): void;
  visible(): readonly ResultLayer[];
  snapshot(): Readonly<Partial<ResultLayerPayloads>>;
}

const order: readonly ResultLayer[] = ["topology", "displacement", "stress", "temperature", "flux", "mechanism"];

function finiteTuple(value: unknown, length: number, positive: boolean, label: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== length
    || value.some((entry) => !Number.isFinite(entry) || (positive && entry <= 0))) {
    throw new RangeError(`${label} must contain ${length} ${positive ? "positive " : ""}finite values`);
  }
  return value as readonly number[];
}

function fieldCount(payload: FieldGrid): number {
  const dimensions = finiteTuple(payload.dimensions, 3, true, "field dimensions");
  if (dimensions.some((value) => !Number.isSafeInteger(value))) {
    throw new RangeError("field dimensions must be positive safe integers");
  }
  finiteTuple(payload.cellSize, 3, true, "field cell size");
  finiteTuple(payload.origin, 3, false, "field origin");
  const count = dimensions[0]! * dimensions[1]! * dimensions[2]!;
  if (!Number.isSafeInteger(count)) throw new RangeError("field cell count must be a safe integer");
  if (!(payload.active instanceof Uint8Array) || payload.active.length !== count) {
    throw new RangeError("field active occupancy length must match cell count");
  }
  if (payload.active.some((value) => value !== 0 && value !== 1)) {
    throw new RangeError("field active occupancy must be binary");
  }
  return count;
}

function finiteField(values: unknown, length: number, label: string): asserts values is Float32Array {
  if (!(values instanceof Float32Array) || values.length !== length) {
    throw new RangeError(`${label} length must match the field cell count`);
  }
  if (!values.every(Number.isFinite)) throw new RangeError(`${label} values must be finite`);
}

function validateField(layer: Exclude<ResultLayer, "mechanism">,
  payload: ResultLayerPayloads[Exclude<ResultLayer, "mechanism">]): void {
  const count = fieldCount(payload);
  if (layer === "topology") {
    finiteField((payload as ResultLayerPayloads["topology"]).density, count, "topology density");
    return;
  }
  const scalar = payload as ScalarField;
  finiteField(scalar.values, count, `${layer} scalar`);
  if (!Number.isFinite(scalar.maximum) || scalar.maximum <= 0) {
    throw new RangeError(`${layer} maximum must be positive and finite`);
  }
  if (layer === "displacement") {
    const displacement = payload as ResultLayerPayloads["displacement"];
    if (displacement.displacementUnit !== "mm") {
      throw new Error("displacement vectors must use scene-compatible millimetres");
    }
    if (displacement.sourceDisplacementUnit !== undefined
      && displacement.sourceDisplacementUnit !== "m" && displacement.sourceDisplacementUnit !== "mm") {
      throw new Error("displacement source unit must be metres or millimetres");
    }
    finiteField(displacement.vectors, count * 3, "displacement vectors");
  }
  if (layer === "flux") {
    const flux = payload as ResultLayerPayloads["flux"];
    if (flux.vectorUnit !== "W/m^2") throw new Error("flux vectors must use W/m^2");
    finiteField(flux.vectors, count * 3, "flux vectors");
  }
}

export function createResultLayers(): ResultLayers {
  const values: Partial<ResultLayerPayloads> = {};
  return {
    set(layer, payload) {
      if (!payload) {
        delete values[layer];
        return;
      }
      if (layer === "mechanism") {
        const mechanism = payload as ResultLayerPayloads["mechanism"];
        if (mechanism.transform.length !== 16 || !mechanism.transform.every(Number.isFinite)) {
          throw new RangeError("mechanism transform must contain 16 finite values");
        }
      } else validateField(layer, payload as never);
      Object.assign(values, { [layer]: payload });
    },
    visible: () => order.filter((layer) => values[layer] !== undefined),
    snapshot: () => ({ ...values }),
  };
}
