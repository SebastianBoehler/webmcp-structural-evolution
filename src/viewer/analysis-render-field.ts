import type { StructuralAnalysisFields, TopologyMetrics } from "../gpu/compute-probe";
import type { ScalarAnalysisCaseField, ScalarAnalysisField } from "./render-envelope";

type AnalysisLayer = "displacement" | "stress" | "safety";

function cases(
  analysis: StructuralAnalysisFields,
  field: "displacement" | "stress",
  maximum: number,
  convert: (values: Float32Array) => Float32Array = (values) => values,
): ScalarAnalysisField["cases"] {
  if (!analysis.cases) return undefined;
  return Object.fromEntries(Object.entries(analysis.cases).flatMap(([loadCase, value]) => {
    if (!value) return [];
    const values = convert(value[field]);
    const result: ScalarAnalysisCaseField = { values, maximum };
    return [[loadCase, result]];
  })) as ScalarAnalysisField["cases"];
}

export function analysisRenderField(
  analysis: StructuralAnalysisFields,
  topology: TopologyMetrics,
  layer: AnalysisLayer,
): ScalarAnalysisField {
  if (layer === "displacement") {
    throw new Error("signed displacement vectors are required; legacy scalar displacement is hidden.");
  }
  if (layer === "stress") return {
    kind: layer,
    values: analysis.stress,
    maximum: Math.max(topology.maxStress, Number.EPSILON),
    cases: cases(analysis, "stress", Math.max(topology.maxStress, Number.EPSILON)),
  };
  const failureStress = topology.maxStress * topology.minimumSafetyFactor;
  const convert = (values: Float32Array) => Float32Array.from(
    values, (stress) => stress / Math.max(failureStress, 1),
  );
  return {
    kind: layer,
    values: convert(analysis.stress),
    maximum: 1,
    cases: cases(analysis, "stress", 1, convert),
  };
}
