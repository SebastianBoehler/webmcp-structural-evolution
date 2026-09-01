import type { AuthoritativeComponentDocument } from "../models/component-documents";

export type ShowcaseModelState = "verified" | "stale" | "failure";
export type ShowcaseModelEvidence = Readonly<{
  modelId: string;
  authority: "parametric-specification-model";
  sourceRevision: string;
  componentCount: number;
  bodyCount: number;
  state: ShowcaseModelState;
}>;

export function componentShowcaseEvidence(
  model: AuthoritativeComponentDocument,
  state: ShowcaseModelState,
): ShowcaseModelEvidence {
  if (model.authority !== "parametric-specification-model") {
    throw new Error("Showcase routes require parametric specification model authority");
  }
  return Object.freeze({
    modelId: model.document.id,
    authority: model.authority,
    sourceRevision: model.document.revision,
    componentCount: model.componentInstances.length,
    bodyCount: model.document.bodies.length,
    state,
  });
}
