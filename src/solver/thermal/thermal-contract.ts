import type { SemanticMeshPayload } from "../../cad/rebuild-payload";

export const THERMAL_VOXEL_MEDIA_TYPE = "application/vnd.structural-evolution.thermal-voxel-domain-v1";

export interface ThermalVoxelPayload extends Readonly<Record<string, ArrayBufferView>> {
  readonly dimensions: Uint32Array;
  readonly originM: Float64Array;
  readonly cellSizeM: Float64Array;
  readonly activeCells: Uint32Array;
  readonly selectionTopologyIdsUtf8: Uint8Array;
  readonly selectionFaceOffsets: Uint32Array;
  readonly selectionFaceCells: Uint32Array;
  readonly selectionFaceAxes: Uint8Array;
  readonly selectionFaceDirections: Int8Array;
  readonly selectionFaceAreasM2: Float64Array;
  readonly rasterizationToleranceM: Float64Array;
}

export interface ThermalSolveInput {
  readonly semanticMeshArtifactId: string;
  readonly semanticMeshPayload: SemanticMeshPayload;
  readonly exactBrepArtifactId: string;
  readonly thermalVoxelArtifactId: string;
  readonly voxelPayload: ThermalVoxelPayload;
}

export interface ThermalCompileLimits {
  readonly maxCells: number;
  readonly maxBoundaryFaces: number;
  readonly maxRelativeAreaError: number;
}

export interface ThermalGrid {
  readonly cellDimensions: readonly [number, number, number];
  readonly originM: readonly [number, number, number];
  readonly cellSizeM: number;
}

export interface ThermalDirichletCell {
  readonly cellIndex: number;
  readonly temperatureK: number;
}

export interface ThermalNeumannFace {
  readonly cellIndex: number;
  readonly axis: 0 | 1 | 2;
  readonly direction: -1 | 1;
  readonly areaM2: number;
  readonly heatFluxWm2: number;
}

export interface ThermalRasterizedSelection {
  readonly selectionId: string;
  readonly topologyId: string;
  readonly faceCount: number;
  readonly selectedAreaM2: number;
  readonly representedAreaM2: number;
  readonly relativeAreaError: number;
}

export interface ThermalInput {
  readonly sourceRevision: string;
  readonly studyId: string;
  readonly bodyIds: readonly string[];
  readonly consumedArtifactIds: readonly [string, string, string];
  readonly grid: ThermalGrid;
  readonly activeCells: Uint32Array;
  readonly activeCellCount: number;
  readonly conductivityWmK: Float32Array;
  readonly dirichletCells: readonly ThermalDirichletCell[];
  readonly neumannFaces: readonly ThermalNeumannFace[];
  readonly rasterization: Readonly<{
    toleranceM: number;
    selections: readonly ThermalRasterizedSelection[];
  }>;
  readonly capability: Readonly<{
    maxCells: number;
    maxBoundaryFaces: number;
    maxRelativeAreaError: number;
  }>;
}

export const DEFAULT_THERMAL_COMPILE_LIMITS: Omit<ThermalCompileLimits, "maxRelativeAreaError"> = Object.freeze({
  maxCells: 262_144,
  maxBoundaryFaces: 1_048_576,
});

export function harmonicConductivityWmK(leftWmK: number, rightWmK: number): number {
  if (!Number.isFinite(leftWmK) || !Number.isFinite(rightWmK) || leftWmK <= 0 || rightWmK <= 0) {
    throw new Error("Thermal conductivity must be positive and finite");
  }
  return 2 / (1 / leftWmK + 1 / rightWmK);
}
