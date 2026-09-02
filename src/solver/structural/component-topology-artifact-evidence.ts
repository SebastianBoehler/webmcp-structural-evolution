import type { ArtifactRecord } from "../../cad/artifact-contract";
import type { ComponentStudyRun } from "../../workspace/component-showcase-runtime";
import {
  TOPOLOGY_DECISION_MEDIA_TYPE, TOPOLOGY_DENSITY_MEDIA_TYPE, TOPOLOGY_MESH_MEDIA_TYPE,
  type TopologyResult, type TopologySolveInput,
} from "../topology/topology-contract";
import { STRUCTURAL_VOXEL_MEDIA_TYPE } from "./structural-contract";

const DISPLACEMENT_MEDIA_TYPE =
  "application/vnd.structural-evolution.structural-field-v1; quantity=displacement";
const STRESS_MEDIA_TYPE =
  "application/vnd.structural-evolution.structural-field-v1; quantity=von-mises-stress";

type Run = ComponentStudyRun<TopologySolveInput, TopologyResult>;
type Dependency = ArtifactRecord["dependencies"][number];
const dependencyKey = (value: Dependency) => value.kind === "entity"
  ? `entity:${value.reference}` : `artifact:${value.artifactId}`;

function assertDependencies(
  record: ArtifactRecord,
  expected: readonly Dependency[],
  role: string,
): void {
  const actualKeys = record.dependencies.map(dependencyKey).sort();
  const expectedKeys = expected.map(dependencyKey).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`Component topology artifact bundle has invalid ${role} dependencies`);
  }
}

export async function validateComponentTopologyArtifactBundle(run: Run): Promise<readonly string[]> {
  const records = run.result.artifacts.map(({ record }) => record);
  const recordIds = new Set(records.map(({ id }) => id)), committed = new Set(run.artifactIds);
  if (records.length !== 6 || run.artifactIds.length !== 6 || committed.size !== 6
    || recordIds.size !== 6 || records.some(({ id }) => !committed.has(id))) {
    throw new Error("Component topology artifact bundle must contain six committed artifacts");
  }
  const role = (kind: ArtifactRecord["kind"], mediaType: string, label: string) => {
    const matches = records.filter((record) => record.kind === kind && record.mediaType === mediaType);
    if (matches.length !== 1) {
      throw new Error(`Component topology artifact bundle has invalid ${label} role`);
    }
    return matches[0]!;
  };
  const density = role("field", TOPOLOGY_DENSITY_MEDIA_TYPE, "density-history");
  const mesh = role("manufacturing-mesh", TOPOLOGY_MESH_MEDIA_TYPE, "manufacturing-mesh");
  const voxel = role("solver-mesh", STRUCTURAL_VOXEL_MEDIA_TYPE, "rerasterized-voxel");
  const displacement = role("field", DISPLACEMENT_MEDIA_TYPE, "displacement");
  const stress = role("field", STRESS_MEDIA_TYPE, "stress");
  const decision = role("field", TOPOLOGY_DECISION_MEDIA_TYPE, "decision");
  if (voxel.id !== run.result.output.rerasterizedVoxelArtifact.id) {
    throw new Error("Component topology artifact bundle does not bind its rerasterized voxel");
  }
  const request = run.request, source = request.input.sourceStructuralRequest;
  const study = { kind: "entity", reference: `study:${request.studyId}` } as const;
  const base = [study, ...request.inputArtifacts.map(({ id }) => ({
    kind: "artifact" as const, artifactId: id,
  }))];
  assertDependencies(density, base, "density-history");
  assertDependencies(mesh, base, "manufacturing-mesh");
  const originalVoxel = source.inputArtifacts.find(({ id }) => id === source.input.voxelArtifactId);
  if (!originalVoxel) throw new Error("Component topology artifact bundle lost its source voxel");
  const sourceEntities = originalVoxel.dependencies.filter(
    (dependency): dependency is Extract<Dependency, { readonly kind: "entity" }> =>
      dependency.kind === "entity",
  );
  const owner = sourceEntities.some(
    (dependency) => dependency.reference === `study:${request.studyId}`,
  ) ? [] : [study];
  assertDependencies(voxel, [...sourceEntities, ...owner,
    { kind: "artifact", artifactId: source.input.semanticMeshArtifactId },
    { kind: "artifact", artifactId: mesh.id }], "rerasterized-voxel");
  const fields = [study,
    { kind: "artifact", artifactId: source.input.semanticMeshArtifactId } as const,
    { kind: "artifact", artifactId: voxel.id } as const];
  assertDependencies(displacement, fields, "displacement");
  assertDependencies(stress, fields, "stress");
  assertDependencies(decision, [study, ...[density, mesh, voxel, displacement, stress]
    .map(({ id }) => ({ kind: "artifact" as const, artifactId: id }))], "decision");
  const ordered = [density, mesh, voxel, displacement, stress, decision];
  for (const { id } of ordered) if (await run.readArtifact(id) === undefined) {
    throw new Error(`Component topology artifact payload is unavailable: ${id}`);
  }
  return ordered.map(({ id }) => id);
}
