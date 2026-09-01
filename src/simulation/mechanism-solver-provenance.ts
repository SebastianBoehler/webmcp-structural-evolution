import { revisionId } from "../domain/revisions";
import {
  DEFAULT_MECHANISM_SOLVER_WORK, type MechanismSolverWork,
} from "./mechanism-solver-work";

export const MECHANISM_ENGINE_VERSION = "0.18.1";
export const MECHANISM_RUNTIME_VERSION = "@dimforge/rapier3d-deterministic-compat@0.18.1";
export const MECHANISM_SOLVER_BUILD_DIGEST = "970e979c55149a563f67452db03eb6fddc549dd83811a4a7856a29d5b2659ebc";
export const MECHANISM_WASM_MODULE_DIGEST = "42462532fe5eb4d443c267d63624954e2ac7c9d3f8c4ed989fd0d5bb80cc0acc";

export async function mechanismSolverProvenance(
  workerArtifactDigest: string,
  solverWork: MechanismSolverWork = DEFAULT_MECHANISM_SOLVER_WORK,
) {
  const settingsDigest = await revisionId({ fixedStepHz: 240, deterministicRuntime: true,
    localFrameConvention: "initial-world-aligned-v1", collisionFiltering: "uint32-physics-hooks-v1",
    ...solverWork });
  const runtimeDigest = await revisionId({ engineVersion: MECHANISM_ENGINE_VERSION,
    runtimeVersion: MECHANISM_RUNTIME_VERSION, solverBuildDigest: MECHANISM_SOLVER_BUILD_DIGEST,
    wasmModuleDigest: MECHANISM_WASM_MODULE_DIGEST, workerArtifactDigest });
  return { engineVersion: MECHANISM_ENGINE_VERSION, runtimeVersion: MECHANISM_RUNTIME_VERSION,
    runtimeDigest, solverBuildDigest: MECHANISM_SOLVER_BUILD_DIGEST,
    wasmModuleDigest: MECHANISM_WASM_MODULE_DIGEST, workerArtifactDigest, settingsDigest } as const;
}

export async function assertMechanismSolverProvenance(
  value: Record<string, unknown>, workerArtifactDigest: string,
  solverWork: MechanismSolverWork = DEFAULT_MECHANISM_SOLVER_WORK,
): Promise<void> {
  const expected = await mechanismSolverProvenance(workerArtifactDigest, solverWork);
  if (Object.entries(expected).some(([key, expectedValue]) => value[key] !== expectedValue)) {
    throw new Error("Mechanism evidence does not match the pinned deterministic runtime");
  }
}
