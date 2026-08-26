import { strFromU8, unzipSync } from "fflate";
import { z } from "zod";

import {
  CadMediaTypeSchema,
  ComponentDefinitionSchema,
  DigestSchema,
  defineComponent,
  type ComponentDefinition,
} from "../domain/component-model";
import { LengthUnitSchema } from "../domain/engineering-units";
import type { DeepReadonly } from "../domain/snapshots";

export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_COUNT = 16;
const componentManifestPath = "component.json";
const entryPath = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/i;

const AssetRoleSchema = z.enum(["display", "source", "collision", "protected"]);
export const ComponentPackageAssetSchema = z.object({
  path: z.string().min(1).max(160),
  digest: DigestSchema,
  mediaType: CadMediaTypeSchema,
  units: LengthUnitSchema,
  role: AssetRoleSchema,
}).strict();

export const ComponentPackageManifestSchema = z.object({
  version: z.literal(1),
  component: ComponentDefinitionSchema,
  assets: z.array(ComponentPackageAssetSchema).max(MAX_ENTRY_COUNT - 1),
}).strict().superRefine((manifest, context) => {
  const paths = new Set<string>();
  for (const [index, asset] of manifest.assets.entries()) {
    if (!entryPath.test(asset.path) || asset.path === componentManifestPath) {
      context.addIssue({ code: "custom", message: "Invalid component package entry path", path: ["assets", index, "path"] });
    }
    if (paths.has(asset.path)) {
      context.addIssue({ code: "custom", message: "Component package asset paths must be unique", path: ["assets", index, "path"] });
    }
    paths.add(asset.path);
  }
  const geometry = manifest.component.geometry;
  if (geometry?.kind === "asset") {
    const geometryAsset = manifest.assets.find(({ digest }) => digest === geometry.assetId);
    if (!geometryAsset || geometryAsset.mediaType !== geometry.mediaType) {
      context.addIssue({ code: "custom", message: "Component geometry must reference a declared matching asset", path: ["component", "geometry"] });
    }
  }
});

type ComponentPackageManifest = z.infer<typeof ComponentPackageManifestSchema>;

export interface ParsedComponentPackage {
  readonly manifest: DeepReadonly<Omit<ComponentPackageManifest, "component"> & { component: ComponentDefinition }>;
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

const extensionsByMediaType = {
  "model/gltf-binary": [".glb"],
  "model/gltf+json": [".gltf"],
  "model/obj": [".obj"],
  "model/stl": [".stl"],
  "model/3mf": [".3mf"],
  "model/step": [".step", ".stp"],
} as const;

export async function digestAsset(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseComponentPackage(file: File): Promise<ParsedComponentPackage> {
  if (file.size > MAX_PACKAGE_BYTES) throw new RangeError("Component package exceeds 50 MB");
  const entries = unzip(new Uint8Array(await file.arrayBuffer()));
  assertSafeEntries(entries);
  const manifestBytes = entries[componentManifestPath];
  if (!manifestBytes) throw new Error("Component package is missing component.json");
  const manifest = ComponentPackageManifestSchema.parse(parseManifest(manifestBytes));
  const canonicalManifest = await canonicalizeManifest(manifest);
  const assets = await verifyDeclaredDigests(entries, canonicalManifest.assets);
  return Object.freeze({ manifest: Object.freeze(canonicalManifest), assets: Object.freeze(assets) });
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error("Component package ZIP could not be read");
  }
}

function parseManifest(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error("Component package manifest is not valid JSON");
  }
}

function assertSafeEntries(entries: Record<string, Uint8Array>) {
  const names = Object.keys(entries);
  if (names.length === 0 || names.length > MAX_ENTRY_COUNT) throw new RangeError("Component package has an invalid entry count");
  let totalBytes = 0;
  for (const [path, bytes] of Object.entries(entries)) {
    if (!entryPath.test(path)) throw new Error("Invalid component package entry path");
    if (path !== componentManifestPath && !supportedExtension(path)) {
      throw new Error("Invalid component package entry path");
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_PACKAGE_BYTES) throw new RangeError("Component package contents exceed 50 MB");
  }
}

async function canonicalizeManifest(manifest: ComponentPackageManifest) {
  const component = await defineComponent(manifest.component);
  return { ...manifest, component };
}

async function verifyDeclaredDigests(
  entries: Record<string, Uint8Array>,
  declarations: readonly z.infer<typeof ComponentPackageAssetSchema>[],
) {
  const assets: Record<string, Uint8Array> = {};
  const declaredPaths = new Set(declarations.map(({ path }) => path));
  for (const path of Object.keys(entries)) {
    if (path !== componentManifestPath && !declaredPaths.has(path)) {
      throw new Error("Component package entry path is not declared by the manifest");
    }
  }
  for (const declaration of declarations) {
    const bytes = entries[declaration.path];
    if (!bytes) throw new Error(`Component package asset is missing: ${declaration.path}`);
    if (!matchesMediaType(declaration.path, declaration.mediaType)) {
      throw new Error(`Component package asset type does not match its declared media type: ${declaration.path}`);
    }
    if (await digestAsset(bytes) !== declaration.digest) {
      throw new Error(`Component package asset digest does not match: ${declaration.path}`);
    }
    assets[declaration.path] = new Uint8Array(bytes);
  }
  return assets;
}

function supportedExtension(path: string) {
  return Object.values(extensionsByMediaType).flat().some((extension) => path.endsWith(extension));
}

function matchesMediaType(path: string, mediaType: keyof typeof extensionsByMediaType) {
  return extensionsByMediaType[mediaType].some((extension) => path.endsWith(extension));
}
