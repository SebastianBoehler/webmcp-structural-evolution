import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { defineComponent } from "../domain/component-model";
import { digestAsset, parseComponentPackage } from "./component-package";

const asset = new Uint8Array([1, 2, 3]);

const sourceComponent = {
  id: "motor-2207",
  category: "motor" as const,
  geometryCoordinates: "component-local" as const,
  manufacturer: "Sunderlabs",
  partNumber: "MOTOR-2207",
  provenance: { kind: "manufacturer-datasheet" as const, reference: "datasheet" },
  mass: { value: 38, unit: "g" as const },
  centerOfMass: { x: { value: 0, unit: "mm" as const }, y: { value: 0, unit: "mm" as const }, z: { value: 0, unit: "mm" as const } },
  envelope: {
    kind: "box" as const,
    id: "envelope",
    center: { x: { value: 0, unit: "mm" as const }, y: { value: 0, unit: "mm" as const }, z: { value: 0, unit: "mm" as const } },
    size: { x: { value: 30, unit: "mm" as const }, y: { value: 30, unit: "mm" as const }, z: { value: 20, unit: "mm" as const } },
  },
  mountInterfaces: [],
  keepOutVolumes: [],
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
} = {}) {
  const bytes = options.asset ?? asset;
  const digest = options.declaredDigest ?? await digestAsset(bytes);
  const component = await defineComponent({
    ...sourceComponent,
    geometry: { ...sourceComponent.geometry, assetId: digest },
  });
  const manifest = {
    version: 1,
    component,
    assets: [{ path: "assets/motor.stl", digest, mediaType: "model/stl", units: options.assetUnits ?? "mm", role: "display" }],
  };
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
});
