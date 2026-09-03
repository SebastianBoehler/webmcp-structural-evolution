import { useMemo } from "react";

import type { AssemblyVisualPart } from "../viewer/render-envelope";
import type { AnalysisLayer } from "./ViewportModeToolbar";
import type { WorkbenchMode } from "./workbench-mode";

interface LoadAnchor {
  readonly id: string;
  readonly label: string;
  readonly anchor: readonly [number, number, number];
}

export function useVisibleAssemblyParts(
  parts: readonly AssemblyVisualPart[],
  motors: readonly LoadAnchor[],
  options: {
    readonly mode: WorkbenchMode;
    readonly analysisLayer: AnalysisLayer;
    readonly showComponents: boolean;
    readonly showConstraints: boolean;
    readonly simulationActive: boolean;
    readonly hasTopology: boolean;
  },
) {
  const { mode, analysisLayer, showComponents, showConstraints, simulationActive, hasTopology } = options;
  return useMemo(() => {
    const topologyVisible = mode !== "assembly" && hasTopology;
    const visible = parts.filter((part) =>
      (showConstraints || part.appearance !== "constraint")
      && (showComponents || part.appearance !== "component")
      && (!topologyVisible || part.appearance !== "design-region"));
    if ((!topologyVisible && !simulationActive) || (analysisLayer !== "loads" && !simulationActive)) return visible;
    return [...visible, ...motors.map((motor): AssemblyVisualPart => ({
      id: `${motor.id}-load-vector`, selectionId: motor.id, label: `${motor.label} 18 N thrust load`,
      appearance: "generated", kind: "load-vector", center: motor.anchor, forceN: [0, 0, -18], length: 28,
    }))];
  }, [analysisLayer, hasTopology, mode, motors, parts, showComponents, showConstraints, simulationActive]);
}
