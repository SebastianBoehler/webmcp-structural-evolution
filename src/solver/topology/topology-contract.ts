import type { ArtifactRecord } from "../../cad/artifact-contract";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import type { StructuralResult, StructuralSolveInput } from "../structural/structural-contract";

export const TOPOLOGY_DENSITY_MEDIA_TYPE = "application/vnd.structural-evolution.topology-history-v1";
export const TOPOLOGY_MESH_MEDIA_TYPE = "application/vnd.structural-evolution.topology-mesh-v1";
export const TOPOLOGY_DECISION_MEDIA_TYPE = "application/vnd.structural-evolution.topology-decision-v1";

export interface TopologySolveInput {
  readonly sourceStructuralRequest: EngineeringSolveRequest<StructuralSolveInput>;
  readonly initialDensity: Float32Array;
}

export interface TopologyObjectiveSample {
  readonly iteration: number;
  readonly objectiveJ: number;
  readonly maskDigest: string;
  readonly structuralResultDigest: string;
}

export interface TopologyMesh {
  readonly positionsM: Float32Array;
  readonly triangles: Uint32Array;
  readonly isoValue: number;
  readonly toleranceM: number;
}

export interface TopologyExtractionValidation {
  readonly closed: boolean;
  readonly oriented: boolean;
  readonly requiredInterfacesConnected: boolean;
  readonly protectedVoidsClear: boolean;
  readonly minimumFeatureSatisfied: boolean;
}

export interface TopologyAcceptanceDecision {
  readonly eligible: boolean;
  readonly accepted: false;
  readonly exportable: false;
  readonly promotionRequired: "task-5-live-gate";
  readonly reasons: readonly string[];
}

export interface TopologyResult {
  readonly truthLevel: "interactive-estimate";
  readonly density: Float32Array;
  readonly objectiveHistory: readonly number[];
  readonly objectiveSamples: readonly TopologyObjectiveSample[];
  readonly materialFraction: number;
  readonly manufacturingMesh: TopologyMesh;
  readonly extraction: TopologyExtractionValidation;
  readonly rerasterizedVoxelArtifact: ArtifactRecord;
  readonly postExtractionAnalysis: StructuralResult;
  readonly acceptance: TopologyAcceptanceDecision;
}

export interface RequiredTopologyInterface {
  readonly id: string;
  readonly cellIndices: Uint32Array;
}
