import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { defineComponent } from "../domain/component-model";
import {
  digestAsset,
  digestComponentPackageManifest,
  parseComponentPackage,
} from "./component-package";

const asset = new Uint8Array([1, 2, 3]);

const sourceComponent = {
  id: "motor-2207",
  category: "motor" as const,
  geometryCoordinates: "component-local" as const,
  manufacturer: "Sunderlabs",
  partNumber: "MOTOR-2207",
  provenance: {
    mode: "sourced-asset" as const,
    licence: { status: "redistributable" as const, reference: "https://example.com/licence" },
    uncertainty: [{ property: "display mesh", statement: "Supplier tessellation tolerance is unspecified." }],
    sources: [{
      id: "datasheet",
      classification: "manufacturer-datasheet" as const,
      title: "Motor datasheet",
      reference: "https://example.com/motor.pdf",
      sourceTimestamp: "2026-07-01" as const,
      accessedOn: "2026-08-26" as const,
      redistribution: "redistributable" as const,
    }],
    sourceObservations: [{ property: "body diameter", value: 30, unit: "mm", sourceId: "datasheet" }],
  },
  mass: { value: 38, unit: "g" as const },
  massAccounting: "standalone" as const,
  optimizationRole: "fixed-component" as const,
  centerOfMass: { x: { value: 0, unit: "mm" as const }, y: { value: 0, unit: "mm" as const }, z: { value: 0, unit: "mm" as const } },
  anchor: {
    id: "mount-plane",
    coordinates: "component-local" as const,
    position: { x: { value: 0, unit: "mm" as const }, y: { value: 0, unit: "mm" as const }, z: { value: 0, unit: "mm" as const } },
  },
  envelope: {
    kind: "box" as const,
    id: "envelope",
    center: { x: { value: 0, unit: "mm" as const }, y: { value: 0, unit: "mm" as const }, z: { value: 0, unit: "mm" as const } },
    size: { x: { value: 30, unit: "mm" as const }, y: { value: 30, unit: "mm" as const }, z: { value: 20, unit: "mm" as const } },
  },
  collisionVolumes: [{
    kind: "box" as const,
    id: "collision",
    center: { x: { value: 0, unit: "mm" as const }, y: { value: 0, unit: "mm" as const }, z: { value: 0, unit: "mm" as const } },
    size: { x: { value: 30, unit: "mm" as const }, y: { value: 30, unit: "mm" as const }, z: { value: 20, unit: "mm" as const } },
  }],
  protectedVolumes: [],
  mountInterfaces: [],
  loadContributions: [],
  allowedOrientations: [{ roll: { value: 0, unit: "deg" as const }, pitch: { value: 0, unit: "deg" as const }, yaw: { value: 0, unit: "deg" as const } }],
  geometry: { kind: "asset" as const, assetId: "", mediaType: "model/stl" as const, units: "mm" as const },
  interfaces: [],
};

async function packageFixture(options: {
  asset?: Uint8Array;
  declaredDigest?: string;
  extraEntry?: string;
  assetUnits?: "m" | "mm";
  role?: "display" | "source";
  tamper?: "version" | "role" | "units" | "asset-list";
  recomputeDigest?: boolean;
} = {}) {
  const bytes = options.asset ?? asset;
  const digest = options.declaredDigest ?? await digestAsset(bytes);
  const component = await defineComponent({
    ...sourceComponent,
    geometry: { ...sourceComponent.geometry, assetId: digest },
  });
  const assets = [{ path: "assets/motor.stl", digest, mediaType: "model/stl" as const, units: options.assetUnits ?? "mm", role: options.role ?? "display" }];
  const manifest = {
    version: 1,
    component,
    assets,
    manifestDigest: await digestComponentPackageManifest({
      version: 1,
      componentRevision: component.revision,
      assets,
    }),
  };
  if (options.tamper === "version") Object.assign(manifest, { version: 2 });
  if (options.tamper === "role") Object.assign(assets[0]!, { role: "collision" });
  if (options.tamper === "units") Object.assign(assets[0]!, { units: "m" });
  if (options.tamper === "asset-list") assets.push({ ...assets[0]!, path: "assets/source.stl", role: "source" });
  if (options.recomputeDigest) manifest.manifestDigest = await digestComponentPackageManifest({
    version: manifest.version,
    componentRevision: component.revision,
    assets,
  });
  const entries: Record<string, Uint8Array> = {
    "component.json": strToU8(JSON.stringify(manifest)),
    "assets/motor.stl": bytes,
  };
  if (options.extraEntry) entries[options.extraEntry] = bytes;
  return new File([zipSync(entries)], "motor-2207.zip", { type: "application/zip" });
}

describe("parseComponentPackage", () => {
  it("verifies declared assets and normalizes the returned component to SI", async () => {
    const parsed = await parseComponentPackage(await packageFixture());

    expect(parsed.assets["assets/motor.stl"]).toEqual(asset);
    expect(parsed.manifest.component.mass).toEqual({ value: 0.038, unit: "kg" });
    expect(parsed.manifest.assets[0]).toMatchObject({ units: "mm", role: "display" });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("rejects a package whose asset digest differs from the manifest", async () => {
    const file = await packageFixture({ declaredDigest: "0".repeat(64), asset });

    await expect(parseComponentPackage(file)).rejects.toThrow(/digest/i);
  });

  it("rejects zip traversal and unsupported entries", async () => {
    await expect(parseComponentPackage(await packageFixture({ extraEntry: "../escape.step" }))).rejects.toThrow(/entry path/i);
    await expect(parseComponentPackage(await packageFixture({ extraEntry: "scripts/model.py" }))).rejects.toThrow(/entry path/i);
  });

  it("rejects a geometry asset whose declared units disagree with the component", async () => {
    await expect(parseComponentPackage(await packageFixture({ assetUnits: "m" }))).rejects.toThrow(/units/i);
  });

  it.each(["version", "role", "units", "asset-list"] as const)(
    "rejects manifest %s tampering",
    async (tamper) => {
      await expect(parseComponentPackage(await packageFixture({ tamper }))).rejects.toThrow(/manifest digest/i);
    },
  );

  it("requires the referenced asset to be the declared display representation", async () => {
    await expect(parseComponentPackage(await packageFixture({ role: "source", recomputeDigest: true })))
      .rejects.toThrow(/display/i);
  });

  it("treats asset declaration order as manifest content", async () => {
    const declarations = [
      { path: "assets/display.stl", digest: "a".repeat(64), mediaType: "model/stl" as const, units: "mm" as const, role: "display" as const },
      { path: "assets/source.step", digest: "b".repeat(64), mediaType: "model/step" as const, units: "mm" as const, role: "source" as const },
    ];

    await expect(digestComponentPackageManifest({
      version: 1, componentRevision: "c".repeat(64), assets: declarations,
    })).resolves.not.toBe(await digestComponentPackageManifest({
      version: 1, componentRevision: "c".repeat(64), assets: [...declarations].reverse(),
    }));
  });
});
