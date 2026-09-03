import type { ProbeResult } from "../gpu/compute-probe";
import { visibleInstances, type VoxelGrid } from "./field-instances";
import type { ViewerRenderModel } from "./field-renderer";
import type { AssemblyVisualPart } from "./render-envelope";

type InteractiveEstimate = Extract<ProbeResult, { readonly status: "estimate" }>;

export interface InteractiveEstimatePreview {
  readonly model?: ViewerRenderModel;
  readonly error?: string;
}

export function prepareInteractiveEstimatePreview(
  result: InteractiveEstimate,
  grid: VoxelGrid,
  threshold: number,
  assemblyParts: readonly AssemblyVisualPart[],
): InteractiveEstimatePreview {
  try {
    return {
      model: {
        grid,
        currentInstances: visibleInstances(result.output, grid, threshold),
        densityField: result.output,
        alternativeLayers: [],
        assemblyParts,
      },
    };
  } catch (error) {
    return {
      error: `The interactive estimate field metadata is invalid, so the field is hidden. ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
