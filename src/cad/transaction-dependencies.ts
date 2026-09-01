import type { ChangedReference } from "./command-schema";
import type { DesignDocument } from "./document-schema";

export function addDependentReferences(document: DesignDocument, changed: Set<ChangedReference>): void {
  let added = true;
  while (added) {
    added = false;
    const add = (reference: ChangedReference) => {
      if (!changed.has(reference)) {
        changed.add(reference);
        added = true;
      }
    };
    for (const feature of document.features) {
      if ((feature.kind === "extrude" || feature.kind === "revolve") && changed.has(`sketch:${feature.sketchId}`)) {
        add(`feature:${feature.id}`);
      }
      if (feature.kind !== "extrude" && feature.kind !== "revolve"
        && (changed.has(`feature:${feature.leftFeatureId}`) || changed.has(`feature:${feature.rightFeatureId}`))) {
        add(`feature:${feature.id}`);
      }
    }
    for (const body of document.bodies) {
      if (changed.has(`feature:${body.featureId}`)) add(`body:${body.id}`);
    }
    for (const component of document.components) {
      if (component.bodyIds.some((bodyId) => changed.has(`body:${bodyId}`))) add(`component:${component.id}`);
    }
    for (const instance of document.instances) {
      if (changed.has(`component:${instance.componentId}`)) add(`instance:${instance.id}`);
    }
    for (const selection of document.namedSelections) {
      if (changed.has(`body:${selection.reference.bodyId}`)) add(`named-selection:${selection.id}`);
    }
    for (const mate of document.mates) {
      if (changed.has(`instance:${mate.firstInstanceId}`) || changed.has(`instance:${mate.secondInstanceId}`)
        || changed.has(`named-selection:${mate.firstSelectionId}`) || changed.has(`named-selection:${mate.secondSelectionId}`)) {
        add(`mate:${mate.id}`);
      }
    }
    for (const study of document.studies) {
      switch (study.kind) {
        case "structural-linear":
          if (changed.has(`material:${study.materialId}`)
            || study.bodyIds.some((id) => changed.has(`body:${id}`))
            || study.supports.some((id) => changed.has(`named-selection:${id}`))
            || study.loads.some(({ selectionId }) => changed.has(`named-selection:${selectionId}`))) {
            add(`study:${study.id}`);
          }
          break;
        case "topology":
          if (changed.has(`study:${study.sourceStudyId}`)) add(`study:${study.id}`);
          break;
        case "mechanism":
          if (study.instanceIds.some((id) => changed.has(`instance:${id}`))
            || study.mateIds.some((id) => changed.has(`mate:${id}`))) {
            add(`study:${study.id}`);
          }
          break;
        case "thermal-steady":
          if (("materialAssignments" in study
            ? study.materialAssignments.some(({ materialId }) => changed.has(`material:${materialId}`))
            : changed.has(`material:${study.materialId}`))
            || study.bodyIds.some((id) => changed.has(`body:${id}`))
            || [...(study.boundaries?.temperatures ?? []), ...(study.boundaries?.heatFluxes ?? [])]
              .some(({ selectionId }) => changed.has(`named-selection:${selectionId}`))) {
            add(`study:${study.id}`);
          }
          break;
      }
    }
  }
}
