export {
  parseStructuralTopologyGateReport,
  verifyStructuralTopologyGateReportDigest,
  type StructuralTopologyGateReport,
} from "./browser-gate-report";

import {
  parseStructuralTopologyGateReport, type StructuralTopologyGateReport,
} from "./browser-gate-report";
import {
  runStructuralTopologyBrowserGate as runAudit, type GateTopologyCandidate,
  type GateTopologyCandidates,
} from "./browser-gate-runner";
import type { TopologyMesh } from "../topology/topology-contract";
import { createTopologyMeshArtifact } from "../topology/topology-artifacts";
import type { ShowcaseModelEvidence } from "../../workspace/component-showcase-evidence";
import { componentShowcaseEvidence } from "../../workspace/component-showcase-evidence";
import { droneMotorSideArmDocument, se6UpperArmDocument } from "../../models/component-documents";

export interface LiveStructuralGateCapability {
  readonly sessionId: string;
}
type BenchmarkKey = "cobot";
type BoundCandidate = Readonly<{ sessionId: string; mesh: TopologyMesh }>;
const capabilities = new WeakMap<object, BoundCandidate>();
type GateSessionDependencies = Readonly<{ loadDocuments?: () => Promise<readonly [
  Awaited<ReturnType<typeof droneMotorSideArmDocument>>,
  Awaited<ReturnType<typeof se6UpperArmDocument>>,
]> }>;

function ownMesh(mesh: TopologyMesh): TopologyMesh {
  if (!(mesh.positionsM instanceof Float32Array) || mesh.positionsM.length === 0
    || mesh.positionsM.length % 3 !== 0 || !mesh.positionsM.every(Number.isFinite)
    || !(mesh.triangles instanceof Uint32Array) || mesh.triangles.length === 0
    || mesh.triangles.length % 3 !== 0
    || mesh.triangles.some((index) => index >= mesh.positionsM.length / 3)) {
    throw new Error("Live topology candidate mesh is invalid");
  }
  return Object.freeze({
    positionsM: new Float32Array(mesh.positionsM), triangles: new Uint32Array(mesh.triangles),
    isoValue: mesh.isoValue, toleranceM: mesh.toleranceM,
  });
}

async function bindCandidate(
  report: Extract<StructuralTopologyGateReport, { status: "passed" }>,
  key: BenchmarkKey,
  candidate: GateTopologyCandidate,
): Promise<BoundCandidate> {
  const expected = report.topology[key], actual = candidate.evidence;
  for (const field of [
    "exactBrepArtifactId", "semanticMeshArtifactId", "voxelArtifactId",
    "manufacturingMeshArtifactId", "rerasterizedVoxelArtifactId", "bindingDigest",
  ] as const) {
    if (expected[field] !== actual[field]) {
      throw new Error(`Live ${key} topology candidate does not match the sealed report`);
    }
  }
  const mesh = ownMesh(candidate.mesh);
  const rebound = await createTopologyMeshArtifact(candidate.request, mesh);
  if (rebound.record.id !== expected.manufacturingMeshArtifactId) {
    throw new Error(`Live ${key} topology mesh bytes do not match the sealed artifact`);
  }
  return Object.freeze({ sessionId: report.sessionId, mesh });
}

export async function runStructuralTopologyBrowserGateSession(
  signal?: AbortSignal, dependencies: GateSessionDependencies = {},
): Promise<Readonly<{
  report: StructuralTopologyGateReport;
  capability?: LiveStructuralGateCapability;
  models: readonly ShowcaseModelEvidence[];
}>> {
  let initialModels: readonly ShowcaseModelEvidence[];
  try {
    const [droneModel, cobotModel] = await (dependencies.loadDocuments?.() ?? Promise.all([
      droneMotorSideArmDocument(), se6UpperArmDocument(),
    ]));
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason
      : new DOMException("Structural topology gate was cancelled", "AbortError");
    initialModels = [componentShowcaseEvidence(droneModel, "failure"),
      componentShowcaseEvidence(cobotModel, "failure")];
  } catch (error) {
    if (signal?.aborted) throw error;
    return { models: [], report: parseStructuralTopologyGateReport({ status: "blocked",
      evidenceSource: "live-browser-webgpu", blocker: { stage: "component-model-preflight",
        message: error instanceof Error ? error.message : String(error) },
      console: { statusLines: [], warningCount: 0, errorCount: 0 } }) };
  }
  let candidates: GateTopologyCandidates | undefined;
  const report = await runAudit(signal, (value) => { candidates = value; });
  if (report.status !== "passed") return { report, models: candidates
    ? [candidates.models.drone, candidates.models.cobot] : initialModels };
  if (!candidates) throw new Error("Passed structural topology gate omitted its bound candidates");
  const capability = Object.freeze({ sessionId: report.sessionId });
  const cobot = await bindCandidate(report, "cobot", candidates.cobot);
  capabilities.set(capability, cobot);
  return { report, capability, models: [candidates.models.drone, candidates.models.cobot] };
}

export async function runStructuralTopologyBrowserGate(
  signal?: AbortSignal,
): Promise<StructuralTopologyGateReport> {
  return (await runStructuralTopologyBrowserGateSession(signal)).report;
}

export function isLiveStructuralGateCapability(value: unknown): boolean {
  return typeof value === "object" && value !== null && capabilities.has(value);
}

export function gateReportAuthorizesManufacturing(_report: StructuralTopologyGateReport): false {
  return false;
}

function normal(positions: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!;
  const ux = positions[b * 3]! - ax, uy = positions[b * 3 + 1]! - ay, uz = positions[b * 3 + 2]! - az;
  const vx = positions[c * 3]! - ax, vy = positions[c * 3 + 1]! - ay, vz = positions[c * 3 + 2]! - az;
  const cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] as const;
  const length = Math.hypot(...cross);
  if (!(length > 0)) throw new Error("Live topology candidate contains a degenerate triangle");
  return cross.map((value) => value / length) as [number, number, number];
}

export function serializeLiveAcceptedTopologyStl(
  capability: LiveStructuralGateCapability,
  benchmark: BenchmarkKey,
): DataView {
  const state = capabilities.get(capability);
  if (!state || benchmark !== "cobot") {
    throw new Error("Topology STL export requires a live session-bound Task 5 capability");
  }
  const { mesh, sessionId } = state;
  const triangleCount = mesh.triangles.length / 3;
  const buffer = new ArrayBuffer(84 + triangleCount * 50), view = new DataView(buffer);
  const header = new TextEncoder().encode(`Task5 ${benchmark} ${sessionId}`.slice(0, 80));
  new Uint8Array(buffer, 0, header.length).set(header);
  view.setUint32(80, triangleCount, true);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ids = [...mesh.triangles.slice(triangle * 3, triangle * 3 + 3)];
    const values = [...normal(mesh.positionsM, ids[0]!, ids[1]!, ids[2]!)];
    for (const id of ids) values.push(
      mesh.positionsM[id * 3]!, mesh.positionsM[id * 3 + 1]!, mesh.positionsM[id * 3 + 2]!,
    );
    const offset = 84 + triangle * 50;
    values.forEach((value, index) => view.setFloat32(offset + index * 4, value, true));
    view.setUint16(offset + 48, 0, true);
  }
  return view;
}
