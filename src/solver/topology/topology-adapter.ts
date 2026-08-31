import type { EngineeringSolveRequest, SolverAdapter } from "../../engineering/solver-adapter";
import { compileStructuralStudy } from "../structural/compile-structural-study";
import { StructuralGpuError } from "../structural/structural-gpu-runtime";
import { createWebGpuStructuralAdapter } from "../structural/webgpu-structural-adapter";
import {
  assertTopologyScheduleFeasible, projectTopologyAnalysisDensity, projectTopologyDensity, topologyMask,
} from "./density-constraints";
import { extractTopologyMesh, rasterizeExtractedTopology, validateExtractedTopology } from "./extract-topology";
import { createTopologyMeshArtifact, packInteractiveTopologyRunResult } from "./topology-artifacts";
import type { TopologyObjectiveSample, TopologyResult, TopologySolveInput } from "./topology-contract";
import { topologyStructuralDigest } from "./topology-evidence";
import { filterTopologyDensity, updateTopologyDensity } from "./topology-gpu";
import { configuredTopologyStudy, topologyPassiveCells, validateInitialDensity } from "./topology-input";
import { structuralRequestForTopologyMask } from "./topology-structural-request";

type Request = EngineeringSolveRequest<TopologySolveInput>;

const abort = () => new DOMException("Topology optimization was cancelled", "AbortError");
function checkAbort(signal: AbortSignal): void { if (signal.aborted) throw abort(); }
function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "Topology solve input is invalid";
}

function unsupported(message: string) {
  return {
    supported: false as const,
    error: {
      code: "unsupported-capability" as const, message,
      limit: { kind: "precision" as const, rule: "a live WebGPU adapter and f32 compute device are required" },
    },
  };
}

function capability(request: Request) {
  if (request.kind !== "topology") return unsupported("Topology adapter accepts only topology jobs");
  if (!globalThis.navigator?.gpu) return unsupported("Topology optimization requires live browser WebGPU");
  return { supported: true as const };
}

export function createWebGpuTopologyAdapter(): SolverAdapter<TopologySolveInput, TopologyResult> {
  return {
    capability: { kind: "topology" },
    supports: capability,
    async run(request, signal, emit) {
      const decision = capability(request);
      if (!decision.supported) throw new StructuralGpuError(
        "unsupported-capability", decision.error.message, decision.error.limit,
      );
      try {
        const study = configuredTopologyStudy(request);
        const source = request.input.sourceStructuralRequest;
        const system = await compileStructuralStudy(source);
        const passive = topologyPassiveCells(request, study);
        let density = validateInitialDensity(
          request.input, system.activeCells, passive.requiredCells, passive.protectedCells,
        );
        const radiusCells = Math.ceil(study.filterRadiusM / system.grid.cellSizeM);
        if (study.filterRadiusM < study.minimumFeatureM * 0.5 || radiusCells < 1 || radiusCells > 8) {
          throw new Error("Topology filter radius cannot enforce the configured minimum feature");
        }
        const structural = createWebGpuStructuralAdapter();
        const samples: TopologyObjectiveSample[] = [];
        const binaryMasks: Uint8Array[] = [];
        const analyses: TopologyResult["postExtractionAnalysis"][] = [];
        let latestAnalysis: TopologyResult["postExtractionAnalysis"] | undefined;
        const analyze = async (iteration: number) => {
          checkAbort(signal);
          const active = topologyMask(density, study.extraction.isoValue, system.activeCells);
          const derived = await structuralRequestForTopologyMask(source, active, `iteration-${iteration}`);
          const solved = await structural.run(derived.request, signal, () => undefined);
          checkAbort(signal);
          const result = solved.output;
          if (!Number.isFinite(result.complianceJ) || result.complianceJ < 0) {
            throw new StructuralGpuError("diverged", "Topology structural objective is not finite and nonnegative");
          }
          if (samples.length && result.complianceJ > samples.at(-1)!.objectiveJ) {
            throw new StructuralGpuError("diverged", "Topology objective history is not monotonic");
          }
          samples.push({
            iteration, objectiveJ: result.complianceJ, maskDigest: derived.maskDigest,
            structuralResultDigest: await topologyStructuralDigest(result),
          });
          binaryMasks.push(Uint8Array.from(active));
          analyses.push(result);
          latestAnalysis = result;
          emit({
            progress: Math.min(0.8, 0.05 + 0.7 * (iteration + 1) / (study.maxIterations + 1)),
            partial: { kind: "topology-objective-history", samples: samples.slice(-16) },
          });
        };
        assertTopologyScheduleFeasible(
          topologyMask(density, study.extraction.isoValue, system.activeCells),
          study.maxIterations, study.targetVolumeFraction, study.moveLimit,
          passive.requiredCells, passive.protectedCells, system.activeCells,
        );
        await analyze(0);
        for (let iteration = 1; iteration <= study.maxIterations; iteration += 1) {
          checkAbort(signal);
          const updated = await updateTopologyDensity(
            density, latestAnalysis!.displacementM, system, study.moveLimit, signal,
          );
          checkAbort(signal);
          const filtered = await filterTopologyDensity(
            updated, system.grid.cellDimensions, radiusCells, system.activeCells, signal,
          );
          const continuous = projectTopologyDensity(
            filtered, density, study.targetVolumeFraction, study.moveLimit,
            passive.requiredCells, passive.protectedCells,
            system.activeCells,
          );
          density = projectTopologyAnalysisDensity(
            continuous, binaryMasks.at(-1)!, study.extraction.isoValue,
            study.targetVolumeFraction, study.moveLimit,
            passive.requiredCells, passive.protectedCells, system.activeCells,
          );
          await analyze(iteration);
        }
        const mesh = extractTopologyMesh(system.grid, density, study.extraction, system.activeCells);
        const extraction = validateExtractedTopology(mesh, system.grid, {
          requiredInterfaces: passive.requiredInterfaces,
          protectedVoidCellIndices: Uint32Array.from(passive.protectedCells),
          minimumFeatureM: study.minimumFeatureM,
        });
        if (Object.values(extraction).some((value) => !value)) {
          throw new Error("Topology extracted candidate failed manufacturing validation");
        }
        const meshArtifact = await createTopologyMeshArtifact(request, mesh);
        const rerasterized = rasterizeExtractedTopology(mesh, system.grid);
        if (rerasterized.some((value, cell) => value !== 0 && system.activeCells[cell] === 0)) {
          throw new Error("Topology rerasterization escaped the canonical design domain");
        }
        const post = await structuralRequestForTopologyMask(
          source, rerasterized, "post-extraction", meshArtifact.record,
        );
        checkAbort(signal);
        const postRun = await structural.run(post.request, signal, () => undefined);
        checkAbort(signal);
        emit({ progress: 0.95 });
        return await packInteractiveTopologyRunResult({
          request, density, binaryMasks, analyses, postAnalysis: postRun.output,
        });
      } catch (error) {
        if (error instanceof StructuralGpuError || isAbort(error)) throw error;
        throw new StructuralGpuError("invalid-input", message(error));
      }
    },
  };
}

export type { TopologySolveInput } from "./topology-contract";
