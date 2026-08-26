import { defineComponent, type ComponentDefinition } from "../domain/component-model";
import type { ComponentImport, ImportedComponent } from "./component-import";
import { digestAsset } from "./component-package";
import type { ComponentRenderResource } from "./assembly-workspace-model";
import type { CadMesh } from "./step-import";

const m = (value: number) => ({ value, unit: "m" as const });
const rad = (value: number) => ({ value, unit: "rad" as const });
const point = (x: number, y: number, z: number) => ({ x: m(x), y: m(y), z: m(z) });
const orientation = { roll: rad(0), pitch: rad(0), yaw: rad(0) };
const category = (value: ComponentImport["category"]): ComponentDefinition["category"] => {
  if (value === "motor" || value === "propeller") return value;
  if (value === "electronics" || value === "sensor") return "avionics";
  if (value === "hardware") return "fastener";
  return "body-interface";
};
const mediaType = (extension: string) => extension === "glb" ? "model/gltf-binary" as const
  : extension === "gltf" ? "model/gltf+json" as const : "model/step" as const;

export interface WorkspaceComponentAsset {
  readonly definition: ComponentDefinition;
  readonly resource: ComponentRenderResource;
}

export async function defineImportedComponent(
  input: ComponentImport,
  assetId: string,
  stagedBy: ImportedComponent["stagedBy"],
  validation: ImportedComponent["validation"],
  mesh?: CadMesh,
): Promise<WorkspaceComponentAsset> {
  const half = input.sizeMm.map((value) => value / 2_000) as [number, number, number];
  const today = new Date().toISOString().slice(0, 10);
  const definition = await defineComponent({
    id: `imported-${assetId.slice(0, 12)}`,
    category: category(input.category),
    geometryCoordinates: "component-local",
    manufacturer: input.manufacturer,
    partNumber: input.partNumber,
    provenance: {
      mode: "sourced-asset",
      licence: { status: "unknown" },
      uncertainty: [{ property: "engineering-validation", statement: "Imported display geometry is not load-certified" }],
      sources: [{ id: "import-source", classification: "user-observation", title: input.name, reference: input.sourceUrl, sourceTimestamp: "undated", accessedOn: today, redistribution: "unknown" }],
      sourceObservations: [{ property: "display-envelope", value: input.sizeMm.join(" x "), unit: "mm", sourceId: "import-source" }],
    },
    mass: { value: input.massG / 1_000, unit: "kg" },
    massAccounting: "standalone",
    optimizationRole: "fixed-component",
    centerOfMass: point(0, 0, 0),
    anchor: { id: "anchor", coordinates: "component-local", position: point(0, 0, 0) },
    envelope: { kind: "box", id: "display-envelope", center: point(0, 0, 0), size: point(half[0] * 2, half[1] * 2, half[2] * 2), orientation },
    collisionVolumes: [{ kind: "box", id: "display-collision", center: point(0, 0, 0), size: point(half[0] * 2, half[1] * 2, half[2] * 2), orientation }],
    protectedVolumes: [], mountInterfaces: [], loadContributions: [], allowedOrientations: [orientation], interfaces: [],
    geometry: { kind: "asset", assetId, mediaType: mesh ? "model/step" : input.assetUrl.endsWith(".gltf") ? "model/gltf+json" : "model/gltf-binary", units: input.assetUnits },
  });
  return {
    definition,
    resource: { ...input, stagedBy, validation, sizeMm: input.sizeMm, ...(mesh ? { mesh } : {}) },
  };
}

export async function importedFileAsset(file: File, assetUrl: string, sizeMm: [number, number, number], mesh?: CadMesh) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const digest = await digestAsset(new Uint8Array(await file.arrayBuffer()));
  const input: ComponentImport = {
    name: file.name.replace(/\.(glb|gltf|step|stp)$/i, ""), category: "other", manufacturer: "Imported",
    partNumber: file.name, assetUrl, assetUnits: mesh ? "mm" : "m", sourceUrl: "https://local.invalid/user-file",
    massG: 1, sizeMm,
  };
  const result = await defineImportedComponent(input, digest, "human", "unverified-visual", mesh);
  if (result.definition.geometry.kind !== "asset" || result.definition.geometry.mediaType === mediaType(extension)) return result;
  throw new Error("Imported component media type does not match the selected file");
}
