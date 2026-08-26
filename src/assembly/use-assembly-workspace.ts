import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Vector3Tuple } from "../viewer/field-instances";
import type { ComponentDefinition } from "../domain/component-model";
import type { ComponentImport, ImportedComponent, PendingComponentImport } from "./component-import";
import { parseComponentPackage } from "./component-package";
import { droneAssemblyVisuals, INITIAL_EQUIPMENT, INITIAL_MOTORS, type MotorPlacement, type Point3 } from "./drone-workspace";
import { compileParametricGeometry } from "./parametric-geometry";
import { decodeStepFile, type CadMesh } from "./step-import";

const identifier = () => globalThis.crypto?.randomUUID?.() ?? `component-${Date.now()}`;

function envelopeSizeMm(component: ComponentDefinition): [number, number, number] {
  const envelope = component.envelope;
  return envelope.kind === "box"
    ? [envelope.size.x.value * 1_000, envelope.size.y.value * 1_000, envelope.size.z.value * 1_000]
    : [envelope.radius.value * 2_000, envelope.radius.value * 2_000, envelope.height.value * 1_000];
}

const importCategory = (category: ComponentDefinition["category"]): ComponentImport["category"] => {
  if (category === "motor" || category === "propeller") return category;
  if (category === "avionics" || category === "battery") return "electronics";
  if (category === "fastener" || category === "wiring") return "hardware";
  return "other";
};

export function useAssemblyWorkspace() {
  const [motors, setMotors] = useState<readonly MotorPlacement[]>(INITIAL_MOTORS);
  const [imports, setImports] = useState<readonly ImportedComponent[]>([]);
  const [importPositions, setImportPositions] = useState<Readonly<Record<string, Point3>>>({});
  const [equipmentPositions, setEquipmentPositions] = useState<Readonly<Record<string, Point3>>>(INITIAL_EQUIPMENT);
  const [pending, setPending] = useState<PendingComponentImport>();
  const [layoutState, setLayoutState] = useState<"verified" | "dragging" | "changed">("verified");
  const [layoutVersion, setLayoutVersion] = useState(1);
  const blobUrls = useRef(new Set<string>());
  const parts = useMemo(() => droneAssemblyVisuals(
    motors, imports, importPositions, equipmentPositions,
  ), [motors, imports, importPositions, equipmentPositions]);

  useEffect(() => () => {
    for (const url of blobUrls.current) URL.revokeObjectURL(url);
  }, []);

  const movePart = useCallback((id: string, center: Vector3Tuple, expectedVersion?: number) => {
    if (expectedVersion !== undefined && expectedVersion !== layoutVersion) {
      throw new Error(`Layout is stale. Inspect version ${layoutVersion} before moving a component.`);
    }
    const motorId = motors.find((motor) => id === motor.id || id === `${motor.id}-propeller`)?.id;
    const isMotor = motorId !== undefined;
    const isImport = imports.some((component) => component.id === id);
    const isEquipment = Object.hasOwn(equipmentPositions, id);
    if (!isMotor && !isImport && !isEquipment) throw new Error(`Unknown movable component: ${id}`);
    const selectedPart = parts.find((part) => part.selectionId === id);
    if (!selectedPart) throw new Error(`Movable component visual missing: ${id}`);
    const delta: Vector3Tuple = [
      center[0] - selectedPart.center[0],
      center[1] - selectedPart.center[1],
      center[2] - selectedPart.center[2],
    ];
    if (isMotor) setMotors((current) => current.map((motor) => motor.id === motorId
      ? { ...motor, anchor: [
        motor.anchor[0] + delta[0], motor.anchor[1] + delta[1], motor.anchor[2] + delta[2],
      ] }
      : motor));
    if (isImport) {
      setImportPositions((current) => ({ ...current, [id]: center }));
    }
    if (isEquipment) setEquipmentPositions((current) => ({
      ...current,
      [id]: [
        current[id]![0] + delta[0], current[id]![1] + delta[1], current[id]![2] + delta[2],
      ],
    }));
    setLayoutState("changed");
    setLayoutVersion((current) => current + 1);
  }, [equipmentPositions, imports, layoutVersion, motors, parts]);

  const importFile = useCallback(async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "zip") {
      const parsed = await parseComponentPackage(file);
      const component = parsed.manifest.component;
      let mesh: CadMesh | undefined;
      let assetUrl = "https://local.invalid/parametric-component";
      let assetUnits: "m" | "mm" = "m";
      const geometry = component.geometry;
      if (geometry.kind === "parametric") {
        mesh = await compileParametricGeometry(geometry.graph);
      } else {
        const declaration = parsed.manifest.assets.find(({ digest, role }) =>
          digest === geometry.assetId && role === "display");
        if (!declaration) throw new Error("Component package has no declared display representation");
        if (declaration.mediaType !== "model/gltf-binary" && declaration.mediaType !== "model/gltf+json" && declaration.mediaType !== "model/step") {
          throw new Error(`Display asset type is not supported by this workspace: ${declaration.mediaType}`);
        }
        const bytes = parsed.assets[declaration.path];
        if (!bytes) throw new Error("Component package display asset is missing");
        const displayFile = new File([new Uint8Array(bytes)], declaration.path, { type: declaration.mediaType });
        assetUrl = URL.createObjectURL(displayFile);
        blobUrls.current.add(assetUrl);
        assetUnits = declaration.units;
        if (declaration.mediaType === "model/step") mesh = await decodeStepFile(displayFile);
      }
      const id = identifier();
      const sizeMm: [number, number, number] = mesh ? [...mesh.sizeMm] : envelopeSizeMm(component);
      setImports((current) => [...current, {
        id,
        name: component.partNumber,
        category: importCategory(component.category),
        manufacturer: component.manufacturer,
        partNumber: component.partNumber,
        assetUrl,
        assetUnits,
        sourceUrl: component.provenance.sources[0]?.reference.startsWith("https://")
          ? component.provenance.sources[0].reference : "https://local.invalid/component-package",
        massG: component.mass.value * 1_000,
        sizeMm,
        stagedBy: "human",
        validation: "package-digest-verified",
        ...(mesh ? { mesh } : {}),
      }]);
      setLayoutState("changed");
      setLayoutVersion((current) => current + 1);
      return id;
    }
    if (extension !== "glb" && extension !== "gltf" && extension !== "step" && extension !== "stp") {
      throw new Error("Choose a ZIP, STEP, STP, GLB, or glTF component file.");
    }
    const id = identifier();
    const assetUrl = URL.createObjectURL(file);
    blobUrls.current.add(assetUrl);
    const mesh = extension === "step" || extension === "stp" ? await decodeStepFile(file) : undefined;
    const sizeMm: [number, number, number] = mesh ? [...mesh.sizeMm] : [30, 30, 30];
    setImports((current) => [...current, {
      id,
      name: file.name.replace(/\.(glb|gltf|step|stp)$/i, ""),
      category: "other",
      manufacturer: "Imported",
      partNumber: file.name,
      assetUrl,
      assetUnits: mesh ? "mm" : "m",
      sourceUrl: "https://local.invalid/user-file",
      massG: 1,
      sizeMm,
      stagedBy: "human",
      validation: "unverified-visual",
      ...(mesh ? { mesh } : {}),
    }]);
    setLayoutState("changed");
    setLayoutVersion((current) => current + 1);
    return id;
  }, []);

  const stageImport = useCallback((input: ComponentImport) => {
    const staged = { ...input, id: identifier(), stagedBy: "agent" as const };
    setPending(staged);
    return staged;
  }, []);

  const approveImport = useCallback(() => {
    if (!pending) return;
    setImports((current) => [...current, {
      ...pending,
      stagedBy: "agent",
      validation: "manufacturer-dimensions",
    }]);
    setPending(undefined);
    setLayoutState("changed");
    setLayoutVersion((current) => current + 1);
  }, [pending]);

  const rejectImport = useCallback(() => setPending(undefined), []);
  return {
    motors,
    imports,
    pending,
    parts,
    layoutState,
    layoutVersion,
    setLayoutState,
    movePart,
    importFile,
    stageImport,
    approveImport,
    rejectImport,
  };
}
