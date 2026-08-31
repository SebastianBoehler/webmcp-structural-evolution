import type { ChangedReference, DesignCommand } from "./command-schema";
import type { DesignDocument } from "./document-schema";

export type MutableDesignDocument = {
  -readonly [Key in keyof DesignDocument]: DesignDocument[Key];
};

function materialHasConsumers(document: MutableDesignDocument, materialId: string): boolean {
  return document.studies.some((study) => (
    (study.kind === "structural-linear" || study.kind === "thermal-steady")
    && study.materialId === materialId
  ));
}

function studyHasConsumers(document: MutableDesignDocument, studyId: string): boolean {
  return document.studies.some((study) => study.kind === "topology" && study.sourceStudyId === studyId);
}

export function applyDesignCommand(
  document: MutableDesignDocument,
  command: DesignCommand,
  changed: Set<ChangedReference>,
): string | undefined {
  switch (command.type) {
    case "rename-document":
      document.label = command.label;
      changed.add(`document:${document.id}`);
      return undefined;
    case "define-parameter":
      if (document.parameters.some(({ id }) => id === command.parameter.id)) return "Parameter already exists";
      document.parameters = [...document.parameters, command.parameter];
      changed.add(`parameter:${command.parameter.id}`);
      return undefined;
    case "set-parameter": {
      const index = document.parameters.findIndex(({ id }) => id === command.parameterId);
      if (index === -1) return "Parameter does not exist";
      const parameter = document.parameters[index];
      document.parameters = document.parameters.map((entry, entryIndex) => entryIndex === index
        ? { ...parameter, value: command.value }
        : entry);
      changed.add(`parameter:${command.parameterId}`);
      return undefined;
    }
    case "remove-parameter":
      if (!document.parameters.some(({ id }) => id === command.parameterId)) return "Parameter does not exist";
      document.parameters = document.parameters.filter(({ id }) => id !== command.parameterId);
      changed.add(`parameter:${command.parameterId}`);
      return undefined;
    case "define-frame":
      if (document.frames.some(({ id }) => id === command.frame.id)) return "Frame already exists";
      document.frames = [...document.frames, command.frame];
      changed.add(`frame:${command.frame.id}`);
      return undefined;
    case "define-sketch":
      if (document.sketches.some(({ id }) => id === command.sketch.id)) return "Sketch already exists";
      document.sketches = [...document.sketches, command.sketch];
      changed.add(`sketch:${command.sketch.id}`);
      return undefined;
    case "define-feature":
      if (document.features.some(({ id }) => id === command.feature.id)) return "Feature already exists";
      document.features = [...document.features, command.feature];
      changed.add(`feature:${command.feature.id}`);
      return undefined;
    case "remove-feature":
      if (!document.features.some(({ id }) => id === command.featureId)) return "Feature does not exist";
      if (document.bodies.some((body) => body.featureId === command.featureId)
        || document.features.some((feature) => (feature.kind === "extrude" || feature.kind === "revolve")
          ? false
          : feature.leftFeatureId === command.featureId || feature.rightFeatureId === command.featureId)) {
        return "Feature has consumers";
      }
      document.features = document.features.filter(({ id }) => id !== command.featureId);
      changed.add(`feature:${command.featureId}`);
      return undefined;
    case "define-body":
      if (document.bodies.some(({ id }) => id === command.body.id)) return "Body already exists";
      document.bodies = [...document.bodies, command.body];
      changed.add(`body:${command.body.id}`);
      changed.add(`document:${document.id}`);
      return undefined;
    case "define-component":
      if (document.components.some(({ id }) => id === command.component.id)) return "Component already exists";
      document.components = [...document.components, command.component];
      changed.add(`component:${command.component.id}`);
      return undefined;
    case "place-instance":
      if (document.instances.some(({ id }) => id === command.instance.id)) return "Instance already exists";
      document.instances = [...document.instances, command.instance];
      changed.add(`instance:${command.instance.id}`);
      return undefined;
    case "define-mate":
      if (document.mates.some(({ id }) => id === command.mate.id)) return "Mate already exists";
      document.mates = [...document.mates, command.mate];
      changed.add(`mate:${command.mate.id}`);
      return undefined;
    case "define-named-selection":
      if (document.namedSelections.some(({ id }) => id === command.namedSelection.id)) return "Named selection already exists";
      document.namedSelections = [...document.namedSelections, command.namedSelection];
      changed.add(`named-selection:${command.namedSelection.id}`);
      return undefined;
    case "define-material":
      if (document.materials.some(({ id }) => id === command.material.id)) return "Material already exists";
      document.materials = [...document.materials, command.material];
      changed.add(`material:${command.material.id}`);
      changed.add(`document:${document.id}`);
      return undefined;
    case "remove-material":
      if (!document.materials.some(({ id }) => id === command.materialId)) return "Material does not exist";
      if (materialHasConsumers(document, command.materialId)) return "Material has consumers";
      document.materials = document.materials.filter(({ id }) => id !== command.materialId);
      changed.add(`material:${command.materialId}`);
      changed.add(`document:${document.id}`);
      return undefined;
    case "define-study":
      if (document.studies.some(({ id }) => id === command.study.id)) return "Study already exists";
      document.studies = [...document.studies, command.study];
      changed.add(`study:${command.study.id}`);
      changed.add(`document:${document.id}`);
      return undefined;
    case "remove-study":
      if (!document.studies.some(({ id }) => id === command.studyId)) return "Study does not exist";
      if (studyHasConsumers(document, command.studyId)) return "Study has consumers";
      document.studies = document.studies.filter(({ id }) => id !== command.studyId);
      changed.add(`study:${command.studyId}`);
      changed.add(`document:${document.id}`);
      return undefined;
  }
}
