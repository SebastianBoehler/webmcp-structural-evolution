import type { AssemblyAction } from "./assembly-authoring";

export type ReceiptSpec = { readonly action: string; readonly inputs: Record<string, string> };

export function assemblyActionReceipt(action: AssemblyAction): ReceiptSpec {
  if (action.kind === "stage") return { action: "stage_component_definition", inputs: { parentRevision: action.parentRevision, componentRevision: action.component.revision } };
  if (action.kind === "place") return { action: "place_component", inputs: { parentRevision: action.parentRevision, instanceId: action.instance.instanceId, componentRevision: action.instance.componentRevision } };
  if (action.kind === "move") return { action: "move_assembly_component", inputs: { parentRevision: action.parentRevision, instanceId: action.instanceId } };
  if (action.kind === "constrain") return { action: "constrain_component", inputs: { parentRevision: action.parentRevision, constraintId: action.constraint.id } };
  return { action: "define_protected_region", inputs: { parentRevision: action.parentRevision, regionId: action.region.id } };
}
