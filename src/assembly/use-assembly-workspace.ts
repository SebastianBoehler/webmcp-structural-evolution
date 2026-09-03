import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentDefinition } from "../domain/component-model";
import type { InventoryItem } from "../domain/design";
import { defineActionReceipt, type ActionReceipt } from "../domain/receipts";
import type { Vector3Tuple } from "../viewer/field-instances";
import {
  applyAssemblyAction,
  solveAssemblyConstraints,
  type AssemblyAction,
  type AssemblyAuthoringState,
  type AssemblyConstraint,
  type ComponentInstance,
  type ProtectedRegion,
} from "./assembly-authoring";
import { assemblyActionReceipt, type ReceiptSpec } from "./assembly-workspace-actions";
import { compileAssemblyState } from "./assembly-compile";
import { inspectAssemblyConflicts } from "./assembly-conflicts";
import type { ComponentImport, ImportedComponent, PendingComponentImport } from "./component-import";
import { digestAsset, parseComponentPackage } from "./component-package";
import {
  INITIAL_DRONE_INVENTORY,
  initialDroneWorkspace,
  renderPartsForAssembly,
  type ComponentRenderResource,
  type MotorPlacement,
} from "./drone-workspace";
import type { AssemblyVisualRenderer } from "./assembly-workspace-model";
import { compileParametricGeometry } from "./parametric-geometry";
import { decodeStepFile, type CadMesh } from "./step-import";
import { defineImportedComponent, importedFileAsset } from "./workspace-component-import";
import { REFERENCE_DISPLAY_RESOURCES } from "./reference-display-resources";
import { resolvedAssemblyDraft } from "./resolved-assembly-draft";

const identifier = (): string => globalThis.crypto?.randomUUID?.() ?? `component-${Date.now()}`;
const m = (value: number) => ({ value: value / 1_000, unit: "m" as const });
const rad = (value: number) => ({ value, unit: "rad" as const });
export type LayoutState = "verified" | "dragging" | "changed" | "validating";

function envelopeSizeMm(definition: ComponentDefinition): [number, number, number] {
  const value = (length: { readonly value: number; readonly unit: "m" | "mm" }) =>
    length.unit === "m" ? length.value * 1_000 : length.value;
  return definition.envelope.kind === "box"
    ? [value(definition.envelope.size.x), value(definition.envelope.size.y), value(definition.envelope.size.z)]
    : [value(definition.envelope.radius) * 2, value(definition.envelope.radius) * 2, value(definition.envelope.height)];
}

export interface AssemblyWorkspaceOptions {
  readonly initialState?: AssemblyAuthoringState;
  readonly inventory?: readonly InventoryItem[];
  readonly renderParts?: AssemblyVisualRenderer;
}

function importedView(state: AssemblyAuthoringState, resources: Readonly<Record<string, ComponentRenderResource>>): readonly ImportedComponent[] {
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

export function useAssemblyWorkspace(options: AssemblyWorkspaceOptions = {}) {
  const inventory = options.inventory ?? INITIAL_DRONE_INVENTORY;
  const [workspace, setWorkspace] = useState(options.initialState ?? initialDroneWorkspace);
  const [resources, setResources] = useState<Readonly<Record<string, ComponentRenderResource>>>(
    options.initialState ? {} : REFERENCE_DISPLAY_RESOURCES,
  );
  const [receipts, setReceipts] = useState<readonly ActionReceipt[]>([]);
  const [pending, setPending] = useState<PendingComponentImport>();
  const [layoutState, setLayoutState] = useState<LayoutState>("verified");
  const [layoutVersion, setLayoutVersion] = useState(1);
  const stateRef = useRef(workspace);
  const versionRef = useRef(1);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const blobUrls = useRef(new Set<string>());
  const draft = useMemo(() => resolvedAssemblyDraft(workspace), [workspace]);
  const renderParts = options.renderParts ?? renderPartsForAssembly;
  const parts = useMemo(
    () => renderParts(draft, workspace.catalog, resources),
    [draft, renderParts, resources, workspace.catalog],
  );
  const motors = useMemo(() => draft.components.flatMap((instance): readonly MotorPlacement[] => {
    const definition = workspace.catalog.find(({ revision }) => revision === instance.componentRevision);
    if (definition?.category !== "motor") return [];
    const position = instance.transform.position;
    const mmValue = (value: typeof position.x) => value.unit === "m" ? value.value * 1_000 : value.value;
    return [{ id: instance.instanceId, label: definition.partNumber, anchor: [mmValue(position.x), mmValue(position.y), mmValue(position.z)], movable: true }];
  }), [draft.components, workspace.catalog]);
  const imports = useMemo(() => importedView(workspace, resources), [resources, workspace]);
  const conflicts = useMemo(() => Object.freeze([
    ...inspectAssemblyConflicts(draft, workspace.catalog, inventory),
    ...solveAssemblyConstraints(workspace).constraintConflicts,
  ]), [draft, inventory, workspace]);

  useEffect(() => () => {
    for (const url of blobUrls.current) URL.revokeObjectURL(url);
  }, []);

  const transact = useCallback((operation: (current: AssemblyAuthoringState) => Promise<AssemblyAuthoringState>, receipt?: ReceiptSpec) => {
    const result = queue.current.then(async () => {
      const started = performance.now();
      try {
        const next = await operation(stateRef.current);
        stateRef.current = next;
        versionRef.current += 1;
        setWorkspace(next); setLayoutVersion(versionRef.current); setLayoutState("changed");
        if (receipt) setReceipts((current) => [...current, defineActionReceipt({
          id: identifier(), action: receipt.action, validatedInputs: receipt.inputs, affectedRevision: next.revision,
          outcome: { status: "succeeded", result: { revision: next.revision } },
          duration: { value: performance.now() - started, unit: "ms" }, createdAt: new Date().toISOString(),
        })]);
        return next;
      } catch (cause) {
        if (receipt) setReceipts((current) => [...current, defineActionReceipt({
          id: identifier(), action: receipt.action, validatedInputs: receipt.inputs, affectedRevision: stateRef.current.revision,
          outcome: { status: "failed", error: cause instanceof Error ? cause.message : String(cause) },
          duration: { value: performance.now() - started, unit: "ms" }, createdAt: new Date().toISOString(),
        })]);
        throw cause;
      }
    });
    queue.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);
  const dispatch = useCallback((action: AssemblyAction) => transact((current) => applyAssemblyAction(current, action), assemblyActionReceipt(action)), [transact]);
  const stageComponent = useCallback((component: ComponentDefinition, parentRevision: string) =>
    dispatch({ kind: "stage", component, parentRevision }), [dispatch]);
  const placeComponent = useCallback((instance: ComponentInstance, parentRevision: string) =>
    dispatch({ kind: "place", instance, parentRevision }), [dispatch]);
  const constrainComponent = useCallback((constraint: AssemblyConstraint, parentRevision: string) =>
    dispatch({ kind: "constrain", constraint, parentRevision }), [dispatch]);
  const protectRegion = useCallback((region: ProtectedRegion, parentRevision: string) =>
    dispatch({ kind: "protect", region, parentRevision }), [dispatch]);
  const compileAssembly = useCallback((parentRevision: string) => {
    const compiled = queue.current.then(() => {
      const current = stateRef.current;
      if (current.revision !== parentRevision) throw new Error("Assembly compilation parent revision is stale");
      const started = performance.now();
      const result = compileAssemblyState(current, inventory);
      setReceipts((receipts) => [...receipts, defineActionReceipt({
        id: identifier(), action: "compile_assembly", validatedInputs: { parentRevision }, affectedRevision: current.revision,
        outcome: { status: "succeeded", result: { revision: current.revision, conflictCount: result.conflicts.length } },
        duration: { value: performance.now() - started, unit: "ms" }, createdAt: new Date().toISOString(),
      })]);
      return result;
    });
    queue.current = compiled.then(() => undefined, () => undefined);
    return compiled;
  }, [inventory]);
  const validateLayout = useCallback((expectedVersion: number) => {
    if (expectedVersion !== versionRef.current) {
      return Promise.reject(new Error(`Layout is stale. Inspect version ${versionRef.current} before validating.`));
    }
    setLayoutState("validating");
    const validation = queue.current.then(() => {
      if (expectedVersion !== versionRef.current) throw new Error(`Layout is stale. Inspect version ${versionRef.current} before validating.`);
      const compiled = compileAssemblyState(stateRef.current, inventory);
      if (compiled.conflicts.length > 0) throw new Error(`Assembly validation found ${compiled.conflicts.length} blocking conflict(s).`);
      return compiled;
    });
    queue.current = validation.then(() => undefined, () => undefined);
    return validation.then(
      (compiled) => { setLayoutState("verified"); return compiled; },
      (error: unknown) => { setLayoutState("changed"); throw error; },
    );
  }, [inventory]);

  const movePart = useCallback((id: string, center: Vector3Tuple, expectedVersion?: number) => {
    if (expectedVersion !== undefined && expectedVersion !== versionRef.current) {
      throw new Error(`Layout is stale. Inspect version ${versionRef.current} before moving a component.`);
    }
    const selected = parts.find((part) => part.selectionId === id);
    if (!selected?.movable) throw new Error(`Unknown movable component: ${id}`);
    const delta: Vector3Tuple = [center[0] - selected.center[0], center[1] - selected.center[1], center[2] - selected.center[2]];
    const parentRevision = stateRef.current.revision;
    return transact(async (current) => {
      if (current.revision !== parentRevision) throw new Error("Assembly action parent revision is stale");
      const group = selected.dragGroup ?? selected.selectionId;
      const instanceIds = new Set(parts.filter(({ dragGroup }) => dragGroup === group).map(({ selectionId }) => selectionId));
      let next = current;
      for (const instance of current.draft.components.filter(({ instanceId }) => instanceIds.has(instanceId))) {
        const position = instance.transform.position;
        const mmValue = (value: typeof position.x) => value.unit === "m" ? value.value * 1_000 : value.value;
        next = await applyAssemblyAction(next, {
          kind: "move", parentRevision: next.revision, instanceId: instance.instanceId,
          transform: { ...instance.transform, position: {
            x: m(mmValue(position.x) + delta[0]), y: m(mmValue(position.y) + delta[1]), z: m(mmValue(position.z) + delta[2]),
          } },
        });
      }
      return next;
    }, { action: "move_assembly_component", inputs: { parentRevision, instanceId: id } });
  }, [parts, transact]);

  const installAsset = useCallback(async (definition: ComponentDefinition, resource: ComponentRenderResource, instanceId = identifier()) => {
    setResources((current) => ({ ...current, [definition.revision]: resource }));
    const staged = await stageComponent(definition, stateRef.current.revision);
    const index = Object.keys(resources).length;
    const instance: ComponentInstance = {
      instanceId, componentRevision: definition.revision, quantity: 1,
      transform: { position: { x: m(index * 38 - 19), y: m(0), z: m(22) }, orientation: { roll: rad(0), pitch: rad(0), yaw: rad(0) } },
    };
    await placeComponent(instance, staged.revision);
    return instanceId;
  }, [placeComponent, resources, stageComponent]);

  const importFile = useCallback(async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "zip") {
      const parsed = await parseComponentPackage(file);
      const definition = parsed.manifest.component;
      const geometry = definition.geometry;
      let mesh: CadMesh | undefined;
      let assetUrl = "https://local.invalid/parametric-component";
      let assetUnits: "m" | "mm" = "m";
      if (geometry.kind === "parametric") mesh = await compileParametricGeometry(geometry.graph);
      else {
        const declaration = parsed.manifest.assets.find(({ digest, role }) => digest === geometry.assetId && role === "display");
        if (!declaration) throw new Error("Component package has no declared display representation");
        if (declaration.mediaType !== "model/gltf-binary" && declaration.mediaType !== "model/gltf+json" && declaration.mediaType !== "model/step") {
          throw new Error(`Display asset type is not supported by this workspace: ${declaration.mediaType}`);
        }
        const bytes = parsed.assets[declaration.path];
        if (!bytes) throw new Error("Component package display asset is missing");
        const displayFile = new File([new Uint8Array(bytes)], declaration.path, { type: declaration.mediaType });
        assetUrl = URL.createObjectURL(displayFile); blobUrls.current.add(assetUrl); assetUnits = declaration.units;
        if (declaration.mediaType === "model/step") mesh = await decodeStepFile(displayFile);
      }
      const sizeMm = geometry.kind === "parametric" || !mesh
        ? (definition.envelope.kind === "box" ? [definition.envelope.size.x.value * 1_000, definition.envelope.size.y.value * 1_000, definition.envelope.size.z.value * 1_000] : [definition.envelope.radius.value * 2_000, definition.envelope.radius.value * 2_000, definition.envelope.height.value * 1_000]) as [number, number, number]
        : [...mesh.sizeMm] as [number, number, number];
      return installAsset(definition, { name: definition.partNumber, category: definition.category === "motor" || definition.category === "propeller" ? definition.category : "other", assetUrl, assetUnits, sourceUrl: definition.provenance.sources[0]!.reference, sizeMm, validation: "package-digest-verified", stagedBy: "human", ...(mesh ? { mesh } : {}) });
    }
    if (!extension || !["glb", "gltf", "step", "stp"].includes(extension)) throw new Error("Choose a ZIP, STEP, STP, GLB, or glTF component file.");
    const assetUrl = URL.createObjectURL(file); blobUrls.current.add(assetUrl);
    const mesh = extension === "step" || extension === "stp" ? await decodeStepFile(file) : undefined;
    const asset = await importedFileAsset(file, assetUrl, mesh ? [...mesh.sizeMm] as [number, number, number] : [30, 30, 30], mesh);
    return installAsset(asset.definition, asset.resource);
  }, [installAsset]);

  const replaceDisplayFile = useCallback(async (instanceId: string, file: File) => {
    const started = performance.now();
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["glb", "gltf", "step", "stp"].includes(extension)) {
      throw new Error("Choose a STEP, STP, GLB, or glTF display file.");
    }
    const current = stateRef.current;
    const instance = current.draft.components.find(({ instanceId: id }) => id === instanceId);
    if (!instance) throw new Error(`Select a placed component before replacing display CAD: ${instanceId}`);
    const definition = current.catalog.find(({ revision }) => revision === instance.componentRevision);
    if (!definition) throw new Error(`Component definition is missing for ${instanceId}`);
    const assetUrl = URL.createObjectURL(file);
    blobUrls.current.add(assetUrl);
    const mesh = extension === "step" || extension === "stp" ? await decodeStepFile(file) : undefined;
    const resource: ComponentRenderResource = {
      name: definition.partNumber,
      category: definition.category === "motor" || definition.category === "propeller" ? definition.category : "other",
      assetUrl,
      assetUnits: mesh ? "mm" : "m",
      sourceUrl: definition.provenance.sources[0]!.reference,
      sizeMm: mesh ? [...mesh.sizeMm] : envelopeSizeMm(definition),
      validation: "manufacturer-dimensions",
      stagedBy: "human",
      ...(mesh ? { mesh } : {}),
    };
    setResources((available) => ({ ...available, [definition.revision]: resource }));
    setReceipts((available) => [...available, defineActionReceipt({
      id: identifier(), action: "replace_component_display_geometry",
      validatedInputs: { instanceId, componentRevision: definition.revision, filename: file.name },
      affectedRevision: current.revision,
      outcome: { status: "succeeded", result: { revision: current.revision } },
      duration: { value: performance.now() - started, unit: "ms" }, createdAt: new Date().toISOString(),
    })]);
    return instanceId;
  }, []);

  const stageImport = useCallback((input: ComponentImport) => {
    const staged = { ...input, id: identifier(), stagedBy: "agent" as const };
    setPending(staged); return staged;
  }, []);
  const approveImport = useCallback(async () => {
    if (!pending) return undefined;
    const assetId = await digestAsset(new TextEncoder().encode(pending.assetUrl));
    const asset = await defineImportedComponent(pending, assetId, "agent", "manufacturer-dimensions");
    const id = await installAsset(asset.definition, asset.resource, pending.id);
    setPending(undefined); return id;
  }, [installAsset, pending]);
  const rejectImport = useCallback(() => setPending(undefined), []);

  return {
    ...workspace, draft, inventory, motors, parts, conflicts, receipts, imports, pending, layoutState, layoutVersion,
    setLayoutDragging: (dragging: boolean) => setLayoutState(dragging ? "dragging" : "changed"), movePart, importFile, replaceDisplayFile, stageImport, approveImport, rejectImport,
    stageComponent, placeComponent, constrainComponent, protectRegion, compileAssembly, validateLayout,
  };
}
