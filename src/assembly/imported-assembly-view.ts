import type { ComponentDefinition } from "../domain/component-model";
import type { ImportedComponent } from "./component-import";
import type { ComponentRenderResource } from "./assembly-workspace-model";
import type { AssemblyAuthoringState } from "./assembly-authoring";

export function importedAssemblyView(state: AssemblyAuthoringState, resources: Readonly<Record<string, ComponentRenderResource>>): readonly ImportedComponent[] {
  return state.draft.components.flatMap((instance) => {
    const resource = resources[instance.componentRevision];
    const definition = state.catalog.find(({ revision }) => revision === instance.componentRevision);
    return resource && definition ? [{
      id: instance.instanceId, name: resource.name, category: resource.category,
      manufacturer: definition.manufacturer, partNumber: definition.partNumber,
      assetUrl: resource.assetUrl, assetUnits: resource.assetUnits, sourceUrl: resource.sourceUrl,
      massG: definition.mass.value * 1_000, sizeMm: resource.sizeMm, stagedBy: resource.stagedBy,
      validation: resource.validation, ...(resource.mesh ? { mesh: resource.mesh } : {}),
    }] : [];
  });
}
