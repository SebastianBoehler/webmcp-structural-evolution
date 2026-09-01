import workerAssetUrl from "./mechanism-solver-worker.ts?worker&url";

import { fetchArtifactDigest } from "./mechanism-solver-digest";

export const MECHANISM_SOLVER_WORKER_ASSET_URL = workerAssetUrl;

export const readMechanismSolverWorkerArtifactDigest = (signal: AbortSignal) =>
  fetchArtifactDigest(MECHANISM_SOLVER_WORKER_ASSET_URL, signal);
