export interface CadSurface {
  readonly name: string;
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly indices: Uint32Array;
  readonly color?: readonly [number, number, number];
}

export interface CadMesh {
  readonly surfaces: readonly CadSurface[];
  readonly sizeMm: readonly [number, number, number];
  readonly triangleCount: number;
  /** Preserved only when the mesh originated in the authoritative CAD rebuild. */
  readonly semanticMesh?: SemanticMeshPayload;
}

interface OcctApi {
  ReadStepFile(content: Uint8Array, options: object): unknown;
}

export type OcctLoader = () => Promise<OcctApi>;

type UnknownRecord = Record<PropertyKey, unknown>;
const record = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null;
const numbers = (value: unknown): value is number[] => Array.isArray(value) && value.every(Number.isFinite);

async function loadOcct(): Promise<OcctApi> {
  const [{ default: factory }, { default: wasmUrl }] = await Promise.all([
    import("occt-import-js"),
    import("occt-import-js/dist/occt-import-js.wasm?url"),
  ]);
  return await factory({ locateFile: (path) => path.endsWith(".wasm") ? wasmUrl : path }) as OcctApi;
}

function surfaceFrom(raw: unknown): CadSurface {
  if (!record(raw) || !record(raw.attributes) || !record(raw.attributes.position)
    || !record(raw.index) || !numbers(raw.attributes.position.array) || !numbers(raw.index.array)) {
    throw new Error("Invalid STEP mesh: missing position or index data.");
  }
  const positions = new Float32Array(raw.attributes.position.array);
  const indices = new Uint32Array(raw.index.array);
  if (positions.length === 0 || positions.length % 3 !== 0 || indices.length === 0 || indices.length % 3 !== 0
    || indices.some((index) => index >= positions.length / 3)) {
    throw new Error("Invalid STEP mesh: inconsistent triangle topology.");
  }
  let normals: Float32Array | undefined;
  if (record(raw.attributes.normal) && numbers(raw.attributes.normal.array)) {
    normals = new Float32Array(raw.attributes.normal.array);
    if (normals.length !== positions.length) throw new Error("Invalid STEP mesh: normals do not match vertices.");
  }
  const color = numbers(raw.color) && raw.color.length === 3
    ? raw.color as [number, number, number] : undefined;
  return {
    name: typeof raw.name === "string" ? raw.name : "STEP surface",
    positions,
    indices,
    ...(normals ? { normals } : {}),
    ...(color ? { color } : {}),
  };
}

export async function decodeStepBytes(
  bytes: Uint8Array,
  loader: OcctLoader = loadOcct,
): Promise<CadMesh> {
  if (bytes.byteLength === 0) throw new Error("The STEP file is empty.");
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("STEP files are limited to 64 MB.");
  const occt = await loader();
  const raw = occt.ReadStepFile(bytes, {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.001,
    angularDeflection: 0.35,
  });
  if (!record(raw) || raw.success !== true || !Array.isArray(raw.meshes) || raw.meshes.length === 0) {
    throw new Error("The STEP model could not be tessellated.");
  }
  const surfaces = raw.meshes.map(surfaceFrom);
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const surface of surfaces) {
    for (let index = 0; index < surface.positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis]!, surface.positions[index + axis]!);
        maximum[axis] = Math.max(maximum[axis]!, surface.positions[index + axis]!);
      }
    }
  }
  return {
    surfaces,
    sizeMm: maximum.map((value, axis) => value - minimum[axis]!) as [number, number, number],
    triangleCount: surfaces.reduce((total, surface) => total + surface.indices.length / 3, 0),
  };
}

export async function decodeStepFile(file: File): Promise<CadMesh> {
  return decodeStepBytes(new Uint8Array(await file.arrayBuffer()));
}
import type { SemanticMeshPayload } from "../cad/rebuild-payload";
