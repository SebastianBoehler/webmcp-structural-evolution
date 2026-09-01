import * as THREE from "three";
import { installAssemblyInteractions, type PartInteractionHandlers } from "./assembly-interactions";
import { installTransformGizmo, type TransformGizmoSession } from "./transform-gizmo";
import type { FlightFrame } from "../simulation/flight-scenarios";

import {
  createFieldMeshes,
  highlightFieldMesh,
  type FieldMeshSet,
} from "./field-meshes";
import { updateFlightReplay } from "./field-flight-replay";
import { FieldRendererMountError } from "./field-renderer-error";
import {
  createAssemblyMeshes,
  highlightAssemblyPart,
  type AssemblyMeshSet,
} from "./assembly-meshes";
import { createCleanupLedger, type CleanupToken } from "./cleanup-ledger";
import {
  prepareRenderModel,
  type AssemblyVisualPart,
  type CameraEnvelope,
  type ViewerRenderModel,
} from "./render-envelope";
import {
  type ControlsLike,
  type FieldViewerEnvironment,
  type RendererLike,
  type ResizeEntryLike,
} from "./field-renderer-environment";

export type { ViewerRenderModel } from "./render-envelope";
export type { SemanticViewport } from "./webgpu-renderer";
export { FieldRendererMountError } from "./field-renderer-error";

// A 2x DPR ceiling is a rendering-budget decision: voxel comparisons favor legibility over 3x pixels.
export const MAX_RENDER_DPR = 2;

export type { FieldViewerEnvironment, ResizeEntryLike } from "./field-renderer-environment";

export interface FieldRendererSession {
  dispose(): void;
  setHighlightedBranch(branchRevision: string | undefined): void;
  setSelectedPart(partId: string | undefined): void;
  setAssemblyPartPoses(parts: readonly AssemblyVisualPart[]): void;
  focusSelectedPart(): void;
  setFlightFrame(frame: FlightFrame | undefined): void;
  setReferenceGridVisible(visible: boolean): void;
  setView(view: "isometric" | "top" | "front" | "right"): void;
  setTransformSpace(space: "world" | "local"): void;
  setTranslationSnap(distance: number | null): void;
}
export interface FieldRendererOptions { readonly preserveDrawingBuffer?: boolean }

function cameraFor(envelope: CameraEnvelope): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(38, 1, envelope.near, envelope.far);
  camera.position.set(...envelope.position);
  camera.lookAt(...envelope.target);
  return camera;
}

export function mountFieldRenderer(
  canvas: HTMLCanvasElement,
  model: ViewerRenderModel,
  environment: FieldViewerEnvironment,
  interactions: PartInteractionHandlers = {},
  options: FieldRendererOptions = {},
): FieldRendererSession {
  const prepared = prepareRenderModel(model);
  const referenceLoads = (prepared.assemblyParts ?? []).flatMap((part) => (
    part.kind === "load-vector" ? [Math.hypot(...part.forceN)] : []
  ));
  const referenceMotorLoadN = referenceLoads.length > 0
    ? referenceLoads.reduce((sum, value) => sum + value, 0) / referenceLoads.length
    : undefined;
  const ownership = createCleanupLedger();
  let renderer: RendererLike | undefined;
  let meshSet: FieldMeshSet | undefined;
  let assemblyMeshSet: AssemblyMeshSet | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let frame: number | undefined;
  let frameOwnership: CleanupToken | undefined;
  let controls: ControlsLike | undefined;
  let referenceGrid: THREE.GridHelper | undefined;
  let transformGizmo: TransformGizmoSession | undefined;
  let flightGroup: THREE.Group | undefined;
  let inactive = false;
  let selectedPart: string | undefined;
  let width = 1;
  let height = 1;
  const render = () => {
    frameOwnership?.relinquish();
    frameOwnership = undefined;
    frame = undefined;
    if (inactive || !renderer || !scene || !camera) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const scheduleRender = () => {
    if (!inactive && frame === undefined) {
      const handle = environment.requestFrame(render);
      frame = handle;
      frameOwnership = ownership.own(() => {
        environment.cancelFrame(handle);
        if (frame === handle) {
          frame = undefined;
          frameOwnership = undefined;
        }
      });
    }
  };
  const session: FieldRendererSession = {
    dispose() {
      inactive = true;
      ownership.dispose();
    },
    setHighlightedBranch(branchRevision) {
      if (inactive || !meshSet) return;
      highlightFieldMesh(meshSet.ghostMaterials, branchRevision);
      scheduleRender();
    },
    setSelectedPart(partId) {
      if (inactive || !assemblyMeshSet) return;
      selectedPart = partId;
      highlightAssemblyPart(assemblyMeshSet.materials, partId);
      transformGizmo?.setSelectedPart(partId);
      scheduleRender();
    },
    setAssemblyPartPoses(parts) {
      if (inactive || !assemblyMeshSet) return;
      for (const root of assemblyMeshSet.roots.values()) root.visible = false;
      for (const part of parts) {
        const root = assemblyMeshSet.roots.get(part.id);
        if (!root) throw new Error(`Assembly pose part is outside the mounted catalog: ${part.id}`);
        root.visible = true;
        root.position.set(...part.center);
        root.rotation.set(...(part.rotation ?? [0, 0, 0]));
      }
      scheduleRender();
    },
    focusSelectedPart() {
      if (!camera || !controls || !assemblyMeshSet || !selectedPart) return;
      const part = [...assemblyMeshSet.parts.values()].find((candidate) => candidate.selectionId === selectedPart);
      if (!part) return;
      const previousTarget = new THREE.Vector3(...prepared.camera.target);
      const nextTarget = new THREE.Vector3(...part.center);
      camera.position.add(nextTarget.clone().sub(previousTarget));
      camera.lookAt(nextTarget);
      controls.target.set(...part.center);
      controls.update();
      scheduleRender();
    },
    setFlightFrame(flightFrame) {
      if (!flightGroup || !assemblyMeshSet) return;
      updateFlightReplay(flightFrame, { flightGroup, assemblyMeshSet, meshSet,
        model: prepared, referenceMotorLoadN });
      scheduleRender();
    },
    setReferenceGridVisible(visible) {
      if (!referenceGrid) return;
      referenceGrid.visible = visible;
      scheduleRender();
    },
    setView(view) {
      if (!camera || !controls) return;
      const [x, y, z] = prepared.camera.target;
      const distance = prepared.camera.span * 1.25;
      const offset = view === "top" ? [0, 0, distance]
        : view === "front" ? [0, -distance, 0]
          : view === "right" ? [distance, 0, 0]
            : [distance * 0.78, -distance * 0.72, distance * 0.68];
      camera.up.set(0, 0, view === "top" ? -1 : 1);
      camera.position.set(x + offset[0]!, y + offset[1]!, z + offset[2]!);
      camera.lookAt(x, y, z);
      controls.target.set(x, y, z);
      controls.update();
      scheduleRender();
    },
    setTransformSpace(space) { transformGizmo?.setSpace(space); },
    setTranslationSnap(distance) { transformGizmo?.setSnap(distance); },
  };

  try {
    scene = new THREE.Scene();
    flightGroup = new THREE.Group();
    flightGroup.name = "flight-replay-root";
    scene.add(flightGroup);
    ownership.own(() => scene!.remove(flightGroup!));
    camera = cameraFor(prepared.camera);
    const createdRenderer = environment.createRenderer(canvas, {
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    renderer = createdRenderer;
    ownership.own(() => createdRenderer.dispose());
    const createdControls = environment.createControls(camera, canvas);
    controls = createdControls;
    ownership.own(() => createdControls.dispose());
    environment.prefersReducedMotion();
    createdControls.enableDamping = false;
    createdControls.enablePan = true;
    createdControls.screenSpacePanning = true;
    createdControls.target.set(...prepared.camera.target);
    createdControls.update();
    const attach = (object: THREE.Object3D) => {
      ownership.own(() => scene!.remove(object));
      scene!.add(object);
    };
    const attachFlight = (object: THREE.Object3D) => {
      ownership.own(() => flightGroup!.remove(object));
      flightGroup!.add(object);
    };
    attach(new THREE.HemisphereLight(0xdcefff, 0x526170, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(5, 8, 12);
    attach(key);
    referenceGrid = new THREE.GridHelper(Math.max(240, prepared.camera.span * 1.2), 24, 0x7892a8, 0xb5c0ca);
    referenceGrid.name = "cad-world-grid";
    referenceGrid.rotation.x = Math.PI / 2;
    referenceGrid.position.z = prepared.grid.anchor.position[2];
    const gridMaterials = Array.isArray(referenceGrid.material) ? referenceGrid.material : [referenceGrid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.34;
      ownership.own(() => material.dispose());
    }
    ownership.own(() => referenceGrid!.geometry.dispose());
    attach(referenceGrid);
    assemblyMeshSet = createAssemblyMeshes(prepared.assemblyParts ?? [], {
      own: (release) => ownership.own(release),
      attach: attachFlight,
    }, scheduleRender);
    meshSet = createFieldMeshes(
      prepared.grid,
      prepared.currentInstances,
      prepared.alternativeLayers,
      {
        own: (release) => ownership.own(release),
        attach: attachFlight,
      },
      prepared.densityField,
      prepared.analysisField,
    );
    transformGizmo = installTransformGizmo({
      canvas,
      camera,
      meshSet: assemblyMeshSet,
      controls: createdControls,
      handlers: interactions,
      attach,
      scheduleRender,
      own: (release) => { ownership.own(release); },
    });
    const createdObserver = environment.createResizeObserver(([entry]) => {
      if (inactive || !entry || !renderer) return;
      const rawDpr = environment.devicePixelRatio();
      const validDpr = Number.isFinite(rawDpr) && rawDpr > 0;
      const actualDpr = validDpr ? rawDpr : 1;
      const renderDpr = Math.min(MAX_RENDER_DPR, Math.max(1, actualDpr));
      const deviceSize = validDpr ? entry.devicePixelContentBoxSize?.[0] : undefined;
      width = Math.max(1, deviceSize ? deviceSize.inlineSize / actualDpr : entry.contentRect.width);
      height = Math.max(1, deviceSize ? deviceSize.blockSize / actualDpr : entry.contentRect.height);
      renderer.setPixelRatio(renderDpr);
      renderer.setSize(width, height, false);
      scheduleRender();
    });
    ownership.own(() => createdObserver.disconnect());
    try {
      createdObserver.observe(canvas, { box: "device-pixel-content-box" });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      createdObserver.observe(canvas);
    }
    ownership.own(() => createdControls.removeEventListener("change", scheduleRender));
    createdControls.addEventListener("change", scheduleRender);
    installAssemblyInteractions({
      canvas,
      camera,
      meshSet: assemblyMeshSet,
      controls: createdControls,
      handlers: { onSelect: interactions.onSelect },
      scheduleRender,
      own: (release) => { ownership.own(release); },
    });
    scheduleRender();
  } catch (error) {
    session.dispose();
    throw new FieldRendererMountError(error, session);
  }

  return session;
}
