import type { StructuralAnalysisFields, TopologyMetrics } from "../gpu/compute-probe";
import type { ScalarAnalysisCaseField, ScalarAnalysisField } from "./render-envelope";
import type { ReplayDeformation } from "./replay-deformation";

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
    const vectorsM = value.displacementVectorsM;
    let deformation: ReplayDeformation | undefined;
    if (vectorsM) {
      const vectors = Float32Array.from(vectorsM, (entry) => entry * 1_000);
      let peak = 0;
      for (let index = 0; index < vectors.length; index += 3) {
        peak = Math.max(peak, Math.hypot(vectors[index]!, vectors[index + 1]!, vectors[index + 2]!));
      }
      deformation = { values: Float32Array.from(value.displacement, (entry) => entry * 1_000),
        vectors, maximum: Math.max(peak, Number.EPSILON),
        displacementUnit: "mm", sourceDisplacementUnit: "m" };
    }
    const result: ScalarAnalysisCaseField = { values, maximum,
      ...(deformation ? { deformation } : {}) };
    return [[loadCase, result]];
  })) as ScalarAnalysisField["cases"];
}

export function analysisRenderField(
  analysis: StructuralAnalysisFields,
  topology: TopologyMetrics,
  layer: AnalysisLayer,
): ScalarAnalysisField {
  if (layer === "displacement") return {
    kind: "displacement-magnitude",
    values: analysis.displacement,
    maximum: Math.max(topology.maxDisplacement, Number.EPSILON),
    cases: cases(analysis, "displacement", Math.max(topology.maxDisplacement, Number.EPSILON)),
  };
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
