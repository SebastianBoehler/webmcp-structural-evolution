import type { EngineeringSolveRequest } from "../engineering/solver-adapter";
import { se6MechanismDocument } from "../models/component-documents";
import { SE6_CATALOG, se6Assembly } from "../samples/cobot/cobot-assembly";
import { renderSe6Assembly } from "../samples/cobot/cobot-visuals";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import { componentShowcaseEvidence, type ShowcaseModelEvidence } from "../workspace/component-showcase-evidence";
import { runComponentStudy } from "../workspace/component-showcase-runtime";
import { createMechanismAdapter, type MechanismAdapterInput } from "./mechanism-adapter";
import type { MechanismResult } from "./mechanism-solver";

export interface ComponentMechanismShowcase {
  readonly document: Awaited<ReturnType<typeof se6MechanismDocument>>["document"];
  readonly request: EngineeringSolveRequest<MechanismAdapterInput>;
  readonly visualParts: readonly AssemblyVisualPart[];
  readonly partBodyIds: Readonly<Record<string, string>>;
  readonly model: ShowcaseModelEvidence;
}

export async function componentMechanismEvidence(state: "verified" | "stale" | "failure") {
  return componentShowcaseEvidence(await se6MechanismDocument(), state);
}

export async function buildComponentMechanismShowcase(
  signal: AbortSignal,
): Promise<ComponentMechanismShowcase> {
  const model = await se6MechanismDocument();
  const planned = await runComponentStudy<MechanismAdapterInput, MechanismResult>(
    model, "se6-motion", createMechanismAdapter(), signal,
  );
  const visualParts = renderSe6Assembly(se6Assembly, SE6_CATALOG, {})
    .filter(({ appearance }) => appearance === "component");
  const partBodyIds = Object.freeze(Object.fromEntries(Object.entries(model.stages)
    .flatMap(([stageId, componentIds]) => componentIds.map((id) => [id, stageId]))));
  if (visualParts.length !== model.componentInstances.length
    || visualParts.some(({ selectionId }) => partBodyIds[selectionId] === undefined)) {
    throw new Error("SE-6 component showcase visual ownership is incomplete");
  }
  return Object.freeze({ document: model.document, request: planned.request,
    visualParts, partBodyIds, model: componentShowcaseEvidence(model, "verified") });
}
