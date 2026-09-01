import type { DesignDocument } from "../cad/document-schema";
import {
  componentPlannerAuthority, type ComponentPlannerAuthority,
} from "./component-study-planners";
import type { ExactComponentSource } from "./exact-component-source";
import type { WorkspaceDerivationAuthority } from "./workspace-derivation-receipt";
import { WorkspaceError } from "./workspace-cad";
import type { StudyCompilation, StudyDerivationProof } from "./workspace-study-plan";

export function boundComponentPlanner(
  planner: Function, document: DesignDocument,
): ComponentPlannerAuthority | undefined {
  const authority = componentPlannerAuthority(planner);
  if (authority && (authority.documentId !== document.id
    || authority.documentRevision !== document.revision)) {
    throw new WorkspaceError(
      "invalid-study-input", "Component planner intent is not bound to the active document revision",
    );
  }
  return authority;
}

export async function componentDerivationProof(
  authority: ComponentPlannerAuthority | undefined,
  exact: ExactComponentSource | undefined,
  compilation: StudyCompilation,
  derivations: WorkspaceDerivationAuthority,
): Promise<StudyDerivationProof | undefined> {
  if (!authority || !exact) return undefined;
  return {
    authority: derivations,
    receipt: await derivations.issue({
      exact, compilation, intentDigest: authority.intentDigest,
    }),
    exact,
    intentDigest: authority.intentDigest,
  };
}
