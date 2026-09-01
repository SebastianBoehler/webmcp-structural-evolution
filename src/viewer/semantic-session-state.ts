import type { FlightFrame } from "../simulation/flight-scenarios";
import type { AssemblyVisualPart } from "./render-envelope";
import type { FieldRendererSession } from "./field-renderer";

export interface SemanticSessionState {
  readonly highlighted: string | undefined; readonly selected: string | undefined;
  readonly poses: readonly AssemblyVisualPart[] | undefined; readonly gridVisible: boolean;
  readonly frame: FlightFrame | undefined; readonly view: "isometric" | "top" | "front" | "right";
  readonly space: "world" | "local"; readonly snap: number | null;
}

export function replaySemanticSession(session: FieldRendererSession, state: SemanticSessionState) {
  session.setHighlightedBranch(state.highlighted); session.setSelectedPart(state.selected);
  if (state.poses) session.setAssemblyPartPoses(state.poses);
  session.setReferenceGridVisible(state.gridVisible); session.setFlightFrame(state.frame);
  session.setView(state.view); session.setTransformSpace(state.space); session.setTranslationSnap(state.snap);
}
