import type { SemanticMeshPayload } from "../../cad/rebuild-payload";

export const STRUCTURAL_VOXEL_MEDIA_TYPE = "application/vnd.structural-evolution.voxel-domain-v1";
export const STRUCTURAL_RESULT_MEDIA_TYPE = "application/vnd.structural-evolution.structural-result-v1";
export const STRUCTURAL_FIELD_MEDIA_TYPE = "application/vnd.structural-evolution.structural-field-v1";

export interface StructuralVoxelPayload extends Readonly<Record<string, ArrayBufferView>> {
  readonly dimensions: Uint32Array;
  readonly originM: Float64Array;
  readonly cellSizeM: Float64Array;
  readonly activeCells: Uint32Array;
  readonly selectionTopologyIdsUtf8: Uint8Array;
  readonly selectionCellOffsets: Uint32Array;
  readonly selectionCellIndices: Uint32Array;
  readonly selectionNodeOffsets: Uint32Array;
  readonly selectionNodeIndices: Uint32Array;
  readonly rasterizationToleranceM: Float64Array;
}

export interface StructuralSolveInput {
  readonly semanticMeshArtifactId: string;
  readonly semanticMeshPayload: SemanticMeshPayload;
  readonly voxelArtifactId: string;
  readonly voxelPayload: StructuralVoxelPayload;
}

export interface StructuralCompileLimits {
  readonly maxCells: number;
  readonly maxDofs: number;
}

export interface StructuralGrid {
  readonly cellDimensions: readonly [number, number, number];
  readonly nodeDimensions: readonly [number, number, number];
  readonly originM: readonly [number, number, number];
  readonly cellSizeM: number;
}

export interface StructuralRasterizedSelection {
  readonly selectionId: string;
  readonly topologyId: string;
  readonly cellCount: number;
  readonly nodeCount: number;
  readonly cellHash: string;
  readonly nodeHash: string;
}

export interface CompiledStructuralSystem {
  readonly sourceRevision: string;
  readonly studyId: string;
  readonly bodyIds: readonly string[];
  readonly consumedArtifactIds: readonly [string, string];
  readonly grid: StructuralGrid;
  readonly activeCells: Uint32Array;
  readonly activeCellCount: number;
  readonly fixedDofs: Uint32Array;
  readonly loadsN: Float32Array;
  readonly material: Readonly<{
    youngsModulusPa: number;
    poissonRatio: number;
    failureStressPa: number;
  }>;
  readonly rasterization: Readonly<{
    toleranceM: number;
    selections: readonly StructuralRasterizedSelection[];
  }>;
}

export interface StructuralVerification {
  readonly relativeResidual: number;
  readonly forceBalanceErrorN: number;
  readonly appliedLoadN: number;
  readonly wasmRelativeL2: number;
  readonly analyticalRelativeError?: number;
  readonly numericalGatesPassed: boolean;
  readonly passed: boolean;
  readonly realGpu: true;
}

export interface StructuralResult {
  readonly truthLevel: "interactive-estimate" | "converged-numerical-solve";
  readonly grid: StructuralGrid;
  readonly iterations: number;
  readonly complianceJ: number;
  readonly strainEnergyJ: number;
  readonly maximumDisplacementM: number;
  readonly maximumVonMisesStressPa: number;
  readonly verification: StructuralVerification;
  readonly rasterization: CompiledStructuralSystem["rasterization"];
  readonly displacementM: Float32Array;
  readonly vonMisesStressPa: Float32Array;
}

export const DEFAULT_STRUCTURAL_COMPILE_LIMITS: StructuralCompileLimits = {
  maxCells: 262_144,
  maxDofs: 1_000_000,
};

export const STRUCTURAL_RESIDUAL_TOLERANCE = 1e-5;
export const STRUCTURAL_FORCE_BALANCE_TOLERANCE = 1e-4;
export const STRUCTURAL_WASM_L2_TOLERANCE = 2e-3;
export const STRUCTURAL_MAX_ITERATIONS = 512;
