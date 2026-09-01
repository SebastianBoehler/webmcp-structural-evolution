import { describe, expect, it } from "vitest";
import { OcctKernel } from "occt-wasm";

import { createOcctBridge } from "../cad/kernel/occt-bridge";
import { normalizeDensity, normalizePressure } from "../domain/engineering-units";
import { rebuildDocument } from "../cad/kernel/feature-rebuild";
import { resolveNamedSelections } from "../cad/kernel/named-selection-resolution";
import { referenceAssemblyInstance } from "../samples/reference-drone-assembly";
import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";
import { SE6_CATALOG } from "../samples/cobot/cobot-catalog";
import { SE6_JOINTS, SE6_STAGE_IDS } from "../samples/cobot/cobot-mechanism-geometry";
import { defineComponentCadSource, ComponentCadSourceSchema } from "./component-cad-authority";
import { withDroneComponentStudies } from "./component-study-documents";
import {
  assertRebuiltBodyCoverage,
  assertStagePartition,
  compileQualifiedInterfaces,
  compileMaterial,
  droneMotorSideArmDocument,
  se6MechanismDocument,
  se6UpperArmDocument,
} from "./component-documents";

describe("authoritative component documents", () => {
  it("normalizes source MPa and g/cm^3 material values to DesignDocument SI fields", () => {
    expect(compileMaterial({
      id: "raw-material", youngsModulus: { value: 1700, unit: "MPa" },
      failureStress: { value: 45, unit: "MPa" }, poissonRatio: .39,
      density: { value: 1.01, unit: "g/cm^3" },
    })).toMatchObject({ densityKgM3: 1010, youngsModulusPa: 1.7e9, failureStressPa: 45e6 });
  });

  it("rejects imported STEP authority without owned bytes, digest, and exact import", () => {
    expect(() => ComponentCadSourceSchema.parse({
      authority: "digest-verified-step-import",
      step: { digest: "a".repeat(64), exactImport: "succeeded" },
    })).toThrow();
  });

  it("rejects a digest-verified STEP import whose bytes do not match its digest", async () => {
    await expect(defineComponentCadSource({
      authority: "digest-verified-step-import",
      step: { bytes: new Uint8Array([1, 2, 3]), digest: "0".repeat(64), exactImport: "succeeded" },
    })).rejects.toThrow(/digest mismatch/i);
  });

  it("derives the SE-6 upper arm dimensions from its catalog definition", async () => {
    const model = await se6UpperArmDocument();

    expect(model.authority).toBe("parametric-specification-model");
    expect(model.document.bodies).toHaveLength(1);
    expect(model.componentInstances).toEqual(["upper-arm-housing"]);
    const housing = SE6_CATALOG.find(({ id }) => id === "se6-upper-arm-housing")!;
    if (housing.envelope.kind !== "box") throw new Error("Expected the catalog housing envelope to be a box");
    expect(model.document.sketches[0]!.entities[0]).toMatchObject({
      kind: "rectangle", sizeM: [housing.envelope.size.x.value, housing.envelope.size.y.value],
      centerM: [housing.envelope.center.x.value, housing.envelope.center.y.value],
    });
    expect(model.document.features[0]).toMatchObject({ distanceM: housing.envelope.size.z.value });
  });

  it("maps the drone body support, motor load, material, and protected interfaces", async () => {
    const model = await droneMotorSideArmDocument();
    const sourceCase = DRONE_ARM_FOUNDATION_STUDY.study.loadCases[0]!;
    const material = DRONE_ARM_FOUNDATION_STUDY.study.material;
    expect(model.document.materials).toEqual(expect.arrayContaining([expect.objectContaining({
      id: material.id, densityKgM3: normalizeDensity(material.density).value,
      youngsModulusPa: normalizePressure(material.youngsModulus).value,
    })]));
    expect(model.supports.map(({ region }) => region)).toEqual(sourceCase.fixedRegions);
    expect(model.loads[0]).toMatchObject({ region: sourceCase.forces[0]!.region,
      forceN: [sourceCase.forces[0]!.vector.x.value, sourceCase.forces[0]!.vector.y.value, sourceCase.forces[0]!.vector.z.value] });
    expect(model.protectedInterfaces).toEqual(DRONE_ARM_FOUNDATION_STUDY.assembly.preservedMounts.map((mount) => ({ id: mount.id, mount })));
    expect(model.interfaces.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "body-interface:body-mount-north", "motor-east:motor-mount-1", "motor-east:propeller-shaft-seat",
    ]));
    expect(new Set(model.interfaces.map(({ id }) => id)).size).toBe(model.interfaces.length);

    const motor = model.document.instances.find(({ id }) => id === "motor-east");
    expect(motor).toBeDefined();
    expect(model.document.studies.map(({ kind }) => kind).sort()).toEqual([
      "structural-linear", "topology",
    ]);
    const structural = model.document.studies.find(({ kind }) => kind === "structural-linear");
    if (!structural || structural.kind !== "structural-linear") throw new Error("Expected structural study");
    expect(structural).toMatchObject({
      bodyIds: ["body-interface-body"],
      supports: model.supports.map(({ id }) => id),
      loads: [{ forceN: model.loads[0]!.forceN }],
    });
    const loadRegionId = (model.loads[0]!.region as { id: string }).id;
    expect(structural?.loads).toEqual([{ selectionId: loadRegionId, forceN: model.loads[0]!.forceN }]);
    const topology = model.document.studies.find(({ kind }) => kind === "topology");
    if (!topology || topology.kind !== "topology" || topology.configurationState !== "configured") {
      throw new Error("Expected configured topology");
    }
    const retainedBodyInterfaces = model.protectedInterfaces
      .filter(({ id }) => id.startsWith("body-interface-"))
      .map(({ id }) => id);
    expect(topology.requiredSelectionIds).toEqual(retainedBodyInterfaces);
    expect(topology.protectedVoidSelectionIds).toEqual([]);
    expect(structural?.supports).not.toEqual(expect.arrayContaining(retainedBodyInterfaces));
    expect(model.document.namedSelections.map(({ id }) => id)).toEqual(expect.arrayContaining([
      ...model.supports.map(({ id }) => id), loadRegionId, ...retainedBodyInterfaces,
    ]));
  });

  it("keeps the exact retained support stable while the load moves and changes direction", async () => {
    const model = await droneMotorSideArmDocument();
    const bridge = createOcctBridge(await OcctKernel.init());
    try {
      const resolveSupport = async (load: Readonly<{ region: unknown; forceN: readonly number[] }>) => {
        const document = await withDroneComponentStudies(model.document, {
          bodyId: "body-interface-body",
          supports: [{ id: "offset-support", region: { centerM: [0, 0.08, 0.003] } }],
          loads: [load], protectedInterfaces: model.protectedInterfaces,
        });
        const rebuilt = await rebuildDocument(
          bridge, document, ["semantic-mesh"], new AbortController().signal,
        );
        const resolved = resolveNamedSelections(document, rebuilt.semanticMesh!.faces)
          .find(({ selectionId }) => selectionId === "offset-support");
        expect(resolved).toBeDefined();
        return resolved!.topologyId;
      };

      const eastLoadSupport = await resolveSupport({
        region: { id: "moving-load", centerM: [0.1, 0, 0.003] }, forceN: [1, 0, 0],
      });
      const northLoadSupport = await resolveSupport({
        region: { id: "moving-load", centerM: [0, 0.2, 0.003] }, forceN: [0, 1, 0],
      });

      expect(northLoadSupport).toBe(eastLoadSupport);
    } finally { bridge.dispose(); }
  });

  it("deduplicates matching qualified interfaces and rejects a conflicting duplicate", () => {
    const instance = referenceAssemblyInstance("motor-east");
    const matching = compileQualifiedInterfaces(instance);
    expect(matching.filter(({ id }) => id === "motor-east:motor-mount-1")).toHaveLength(1);
    const conflicting = structuredClone(referenceAssemblyInstance("motor-east"));
    expect(() => compileQualifiedInterfaces(conflicting, { "motor-mount-1": [1, 0, 0] })).toThrow(/conflicting interface/i);
  });

  it("covers every SE-6 instance once across seven stages and preserves six revolute joints", async () => {
    const model = await se6MechanismDocument();

    expect(model.componentInstances).toHaveLength(52);
    expect(new Set(model.componentInstances)).toHaveLength(52);
    expect(Object.keys(model.stages)).toEqual(SE6_STAGE_IDS);
    expect([...Object.values(model.stages).flat()].sort()).toEqual([...model.componentInstances].sort());
    expect(model.joints).toEqual(SE6_JOINTS);
    expect(model.document.studies).toEqual([expect.objectContaining({
      id: "se6-motion", kind: "mechanism", instanceIds: model.componentInstances,
      configurationState: "requires-configuration",
    })]);
    expect(Object.keys(model.bodyMassKg)).toHaveLength(52);
    expect(() => assertStagePartition({ base: ["duplicate", "duplicate"] }, ["duplicate", "missing"])).toThrow(/duplicate/i);
    expect(() => assertStagePartition({ base: ["unknown"] }, ["known"])).toThrow(/unknown/i);
  });

  it("binds the SE-6 upper arm thermal study to exact named end faces", async () => {
    const model = await se6UpperArmDocument();
    expect(model.document.studies).toEqual([expect.objectContaining({
      id: "se6-upper-arm-thermal", kind: "thermal-steady",
      bodyIds: ["upper-arm-housing-body"],
    })]);
    expect(model.document.namedSelections.map(({ id }) => id)).toEqual([
      "mounting-interface", "motor-interface",
    ]);
    expect(model.document.materials[0]).toMatchObject({ thermalConductivityWmK: 167 });
  });

  it("rebuilds every compiled component document through OCCT", async () => {
    const bridge = createOcctBridge(await OcctKernel.init());
    try {
      for (const model of await Promise.all([
        droneMotorSideArmDocument(), se6UpperArmDocument(), se6MechanismDocument(),
      ])) {
        const payload = await rebuildDocument(
          bridge, model.document, ["brep"], new AbortController().signal,
        );
        expect(payload.brep?.bytes.byteLength).toBeGreaterThan(100);
        assertRebuiltBodyCoverage(model.componentInstances, payload.bodyIds);
      }
    } finally { bridge.dispose(); }
  });

  it("rejects incomplete rebuilt body coverage", () => {
    expect(() => assertRebuiltBodyCoverage(["first", "second"], ["first-body", "third-body"])).toThrow(/coverage/i);
  });
});
