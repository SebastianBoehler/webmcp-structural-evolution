import * as THREE from "three";

import { structuralReplayScale, type FlightFrame } from "../simulation/flight-scenarios";
import { restoreAnalysisSurfaceField, updateAnalysisSurfaceField, type FieldMeshSet } from "./field-meshes";
import type { AssemblyMeshSet } from "./assembly-meshes";
import type { ViewerRenderModel } from "./render-envelope";

export interface FlightReplayTargets {
  readonly flightGroup: THREE.Group;
  readonly assemblyMeshSet: AssemblyMeshSet;
  readonly meshSet: FieldMeshSet | undefined;
  readonly model: ViewerRenderModel;
  readonly referenceMotorLoadN: number | undefined;
}

export function updateFlightReplay(frame: FlightFrame | undefined, targets: FlightReplayTargets): void {
  const { flightGroup, assemblyMeshSet, meshSet, model, referenceMotorLoadN } = targets;
  flightGroup.rotation.set(...(frame?.attitudeRad ?? [0, 0, 0]));
  const structuralScale = frame && referenceMotorLoadN !== undefined
    ? structuralReplayScale(frame, referenceMotorLoadN) : frame ? 0 : 1;
  const loadVectors = frame?.motorLoadVectorsN ?? [];
  const meanLoad = Math.max(.001, loadVectors.reduce(
    (sum, vector) => sum + Math.hypot(...vector), 0,
  ) / Math.max(1, loadVectors.length));
  for (const [index, vector] of loadVectors.entries()) {
    const motor = model.assemblyParts?.filter(({ kind }) => kind === "load-vector")[index];
    const root = motor ? assemblyMeshSet.roots.get(motor.id) : undefined;
    if (!root) continue;
    const direction = new THREE.Vector3(...vector), magnitude = direction.length();
    root.visible = magnitude > 1e-6;
    root.scale.set(1, 1, Math.max(.18, magnitude / meanLoad));
    if (root.visible) root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction.normalize());
  }
  if (!frame) for (const [id, root] of assemblyMeshSet.roots) if (id.endsWith("-load-vector")) {
    root.visible = true;
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
  }
  for (const mesh of meshSet?.meshes ?? []) {
    const match = /verified-(?:stress|displacement|safety)-band-(\d+)/.exec(mesh.name);
    if (!match || !(mesh.material instanceof THREE.MeshBasicMaterial)) continue;
    const band = Number(match[1]) / 6, utilization = Math.min(1, band * structuralScale);
    mesh.material.color.copy(new THREE.Color(0x16b9ff).lerp(new THREE.Color(0xff2d55), utilization));
  }
  const activeField = frame ? model.analysisField?.cases?.[frame.solverCase] : undefined;
  if (!frame) restoreAnalysisSurfaceField(meshSet?.analysisSurfaces ?? []);
  else if (activeField) updateAnalysisSurfaceField(
    meshSet?.analysisSurfaces ?? [], activeField.values, activeField.maximum, structuralScale,
  );
  else restoreAnalysisSurfaceField(meshSet?.analysisSurfaces ?? []);
}
