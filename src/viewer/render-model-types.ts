import type { CadMesh } from "../assembly/step-import";
import type { AlternativeLayer } from "./alternative-instances";
import type { PackedInstances, Vector3Tuple, VoxelGrid } from "./field-instances";

export interface ViewerRenderModel {
  readonly grid: VoxelGrid;
  readonly currentInstances: PackedInstances;
  readonly alternativeLayers: readonly AlternativeLayer[];
  readonly assemblyParts?: readonly AssemblyVisualPart[];
  readonly densityField?: Float32Array;
  readonly analysisField?: ScalarAnalysisField;
}

export interface ScalarAnalysisField {
  readonly kind: "displacement" | "stress" | "safety" | "temperature" | "heat-flux";
  readonly values: Float32Array;
  readonly maximum: number;
  readonly cases?: Readonly<Record<string, ScalarAnalysisCaseField | undefined>>;
}

export interface ScalarAnalysisCaseField {
  readonly values: Float32Array;
  readonly maximum: number;
}

export type AssemblyMaterialToken =
  | "structural" | "joint" | "cover" | "fastener" | "cable" | "tooling" | "payload";

export type AssemblyVisualPart = Readonly<{
  id: string; selectionId: string; label: string; center: Vector3Tuple;
  rotation?: Vector3Tuple; dragGroup?: string; movable?: boolean;
  material?: AssemblyMaterialToken; semanticGroup?: string;
  appearance: "component" | "generated" | "design-region" | "constraint";
}> & (
  | Readonly<{ kind: "box"; size: Vector3Tuple }>
  | Readonly<{ kind: "cylinder"; radius: number; height: number }>
  | Readonly<{ kind: "motor-mount"; radius: number; height: number; boltCircle: number; boltRadius: number }>
  | Readonly<{ kind: "motor"; base: AxialVisualFeature; stator: AxialVisualFeature;
      bell: AxialVisualFeature; shaft: AxialVisualFeature;
      mountHoles: readonly MountHoleVisualFeature[]; localBounds: LocalVisualBounds }>
  | Readonly<{ kind: "fastener"; shank: AxialVisualFeature; head: AxialVisualFeature;
      socketWidth: number; socketDepth: number; socketCenterZ: number; localBounds: LocalVisualBounds }>
  | Readonly<{ kind: "flight-controller"; size: Vector3Tuple }>
  | Readonly<{ kind: "propeller"; radius: number; hubRadius: number; hubHeight: number; bladeCount: number }>
  | Readonly<{ kind: "guard"; radius: number; tubeRadius: number }>
  | Readonly<{ kind: "protected-disc"; radius: number; height: number }>
  | Readonly<{ kind: "model"; assetUrl: string; assetUnits: "mm" | "m"; size: Vector3Tuple }>
  | Readonly<{ kind: "mesh"; mesh: CadMesh }>
  | Readonly<{ kind: "load-vector"; forceN: Vector3Tuple; length: number }>
);

export interface AxialVisualFeature { readonly radius: number; readonly height: number; readonly centerZ: number }
export interface MountHoleVisualFeature extends AxialVisualFeature { readonly centerX: number; readonly centerY: number }
export interface LocalVisualBounds { readonly minimum: Vector3Tuple; readonly maximum: Vector3Tuple }
export interface CameraEnvelope {
  readonly target: Vector3Tuple; readonly position: Vector3Tuple;
  readonly span: number; readonly near: number; readonly far: number;
}
export interface PreparedRenderModel extends ViewerRenderModel { readonly camera: CameraEnvelope }
