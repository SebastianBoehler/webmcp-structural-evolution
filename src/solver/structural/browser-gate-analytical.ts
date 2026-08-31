import { resolveNamedSelections } from "../../cad/kernel/named-selection-resolution";

import type { BrowserBenchmarkDefinition, ExactBrowserBenchmark } from "./browser-gate-exact-benchmark";
import { STRUCTURAL_VERIFICATION_METADATA, type StructuralResult } from "./structural-contract";

const COMPONENTS = ["x", "y", "z"] as const;

function topologyIds(benchmark: ExactBrowserBenchmark): readonly string[] {
  try {
    const text = new TextDecoder().decode(
      benchmark.structuralRequest.input.voxelPayload.selectionTopologyIdsUtf8,
    );
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) throw new Error();
    return parsed;
  } catch {
    throw new Error("Analytical load-node topology binding is invalid");
  }
}

function loadedNodes(benchmark: ExactBrowserBenchmark): Uint32Array {
  const request = benchmark.structuralRequest;
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  if (study?.kind !== "structural-linear" || study.loads.length !== 1) {
    throw new Error("Analytical gate requires exactly one revision-owned structural load");
  }
  const resolved = resolveNamedSelections(
    request.document, request.input.semanticMeshPayload.faces,
  ).find(({ selectionId }) => selectionId === study.loads[0]!.selectionId);
  const index = resolved ? topologyIds(benchmark).indexOf(resolved.topologyId) : -1;
  const offsets = request.input.voxelPayload.selectionNodeOffsets;
  const nodes = request.input.voxelPayload.selectionNodeIndices;
  if (index < 0 || offsets.length <= index + 1) {
    throw new Error("Analytical loaded-end selection is absent from the solver mesh");
  }
  const selected = nodes.slice(offsets[index]!, offsets[index + 1]!);
  if (selected.length === 0) throw new Error("Analytical loaded-end selection contains no solver nodes");
  return selected;
}

function expectedDisplacement(definition: BrowserBenchmarkDefinition, youngsModulusPa: number): number {
  const [length, width, height] = definition.sizeM;
  const forceN = Math.hypot(...definition.forceN);
  return definition.id === "axial"
    ? forceN * length / (youngsModulusPa * width * height)
    : forceN * length ** 3 / (3 * youngsModulusPa * (height * width ** 3 / 12));
}

export function analyticalEvidence(
  benchmark: ExactBrowserBenchmark, result: StructuralResult,
) {
  const study = benchmark.structuralRequest.document.studies
    .find(({ id }) => id === benchmark.structuralRequest.studyId);
  const material = study?.kind === "structural-linear"
    ? benchmark.structuralRequest.document.materials.find(({ id }) => id === study.materialId)
    : undefined;
  if (!material || material.kind !== "isotropic") throw new Error("Analytical material binding is missing");
  const axis = benchmark.definition.forceN.reduce((best, value, index, values) =>
    Math.abs(value) > Math.abs(values[best]!) ? index : best, 0);
  if (benchmark.definition.forceN[axis] === 0) throw new Error("Analytical benchmark load axis is unresolved");
  const nodes = loadedNodes(benchmark);
  const measuredDisplacementM = [...nodes].reduce((sum, node) => {
    const displacement = result.displacementM[node * 3 + axis];
    if (displacement === undefined || !Number.isFinite(displacement)) {
      throw new Error("Analytical loaded-end displacement field is incomplete");
    }
    return sum + Math.abs(displacement);
  }, 0) / nodes.length;
  const expected = expectedDisplacement(benchmark.definition, material.youngsModulusPa);
  if (!(measuredDisplacementM > 0) || !(expected > 0)) {
    throw new Error("Analytical loaded-end displacement is not positive");
  }
  const relativeError = Math.abs(measuredDisplacementM - expected) / expected;
  const tolerance = benchmark.definition.id === "axial"
    ? STRUCTURAL_VERIFICATION_METADATA.thresholds.axialRelativeError
    : STRUCTURAL_VERIFICATION_METADATA.thresholds.cantileverRelativeError;
  if (relativeError > tolerance) {
    throw new Error(`${benchmark.definition.id} analytical displacement error ${relativeError} exceeds ${tolerance}`);
  }
  return {
    expectedDisplacementM: expected, measuredDisplacementM, relativeError, tolerance,
    component: COMPONENTS[axis]!, loadedNodeCount: nodes.length,
  };
}
