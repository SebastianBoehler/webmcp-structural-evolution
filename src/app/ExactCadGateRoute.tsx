import type { GpuCapability } from "../gpu/capabilities";
import type { FieldViewerEnvironment } from "../viewer/FieldViewer";
import { ExactCadGateView } from "./ExactCadGateView";
import { useExactCadProjectGate } from "./use-exact-cad-project-gate";

interface ExactCadGateRouteProps {
  readonly capability: GpuCapability;
  readonly viewerEnvironment?: FieldViewerEnvironment;
}

export function ExactCadGateRoute({ capability, viewerEnvironment }: ExactCadGateRouteProps) {
  const gate = useExactCadProjectGate();
  if (gate.status === "inactive") throw new Error("Exact CAD route did not activate its browser gate");
  return <ExactCadGateView
    gate={gate}
    capability={capability}
    viewerEnvironment={viewerEnvironment}
  />;
}
