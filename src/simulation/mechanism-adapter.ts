import { z } from "zod";

import { defineArtifactRecord } from "../cad/artifact-contract";
import { canonicalJson } from "../domain/canonical-json";
import { revisionId } from "../domain/revisions";
import { digestArtifactPayload } from "../engineering/artifact-store";
import type { EngineeringSolveRequest, SolverAdapter } from "../engineering/solver-adapter";
import { compileMechanismStudy } from "./compile-mechanism-study";
import type { MechanismResult } from "./mechanism-solver";
import { solveMechanismStudy } from "./mechanism-solver";

export const MechanismAdapterInputSchema = z.object({ schemaVersion: z.literal(1) }).strict();
export type MechanismAdapterInput = z.infer<typeof MechanismAdapterInputSchema>;

const unsupported = (message: string, rule: string) => ({
  supported: false as const,
  error: {
    code: "unsupported-capability" as const, message,
    limit: { kind: "dimension" as const, rule },
  },
});

function capability(request: EngineeringSolveRequest<unknown>) {
  if (request.kind !== "mechanism") {
    return unsupported("Mechanism adapter accepts only mechanism jobs", "job kind must be mechanism");
  }
  if (!MechanismAdapterInputSchema.safeParse(request.input).success) {
    return unsupported("Mechanism adapter input is not canonical", "input must be { schemaVersion: 1 }");
  }
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  if (!study || study.kind !== "mechanism" || study.configurationState !== "configured") {
    return unsupported("Mechanism study is not configured", "a configured mechanism study is required");
  }
  return { supported: true as const };
}

function abort(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Mechanism adapter run was cancelled", "AbortError");
}

function ownedBytes(bytes: Uint8Array): Uint8Array {
  const owned = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  owned.set(bytes);
  return owned;
}

async function packReplay(
  request: EngineeringSolveRequest<MechanismAdapterInput>,
  result: MechanismResult,
) {
  const replay = JSON.parse(new TextDecoder().decode(result.replay.canonicalBytes));
  const payload = ownedBytes(new TextEncoder().encode(canonicalJson({
    schemaVersion: 1,
    kind: "mechanism-replay",
    lineage: {
      sourceRevision: result.sourceRevision,
      studyId: result.studyId,
      mechanismInputDigest: result.mechanismInputDigest,
      resultDigest: result.resultDigest,
      replayDigest: result.replay.replayDigest,
      sourceArtifactIds: result.sourceArtifactIds,
      evidence: result.evidence,
    },
    replay,
  })));
  const settingsDigest = await revisionId({
    adapter: "mechanism-adapter-v1", requestSettings: request.settings,
    resultDigest: result.resultDigest,
  });
  const record = await defineArtifactRecord({
    kind: "mechanism-replay", sourceRevision: request.sourceRevision,
    producer: { name: "rapier3d-deterministic-compat", version: result.evidence.engineVersion },
    settingsDigest, contentDigest: await digestArtifactPayload(payload), units: "m",
    mediaType: "application/vnd.structural-evolution.mechanism-replay-v1+json",
    dependencies: [
      { kind: "entity" as const, reference: `document:${request.document.id}` as const },
      { kind: "entity" as const, reference: `study:${request.studyId}` as const },
      ...request.document.parameters.map(({ id }) => ({
        kind: "entity" as const, reference: `parameter:${id}` as const,
      })),
      ...request.document.features.map(({ id }) => ({
        kind: "entity" as const, reference: `feature:${id}` as const,
      })),
      ...request.document.bodies.map(({ id }) => ({
        kind: "entity" as const, reference: `body:${id}` as const,
      })),
      ...request.document.instances.map(({ id }) => ({
        kind: "entity" as const, reference: `instance:${id}` as const,
      })),
      ...request.document.mates.map(({ id }) => ({
        kind: "entity" as const, reference: `mate:${id}` as const,
      })),
    ],
  });
  return { record, payload };
}

export function createMechanismAdapter(): SolverAdapter<MechanismAdapterInput, MechanismResult> {
  return {
    capability: { kind: "mechanism" },
    supports: capability,
    async run(request, signal, emit) {
      const decision = capability(request);
      if (!decision.supported) throw decision.error;
      abort(signal);
      emit({ progress: 0.1 });
      const compiled = await compileMechanismStudy(request.document, request.studyId, signal);
      abort(signal);
      emit({ progress: 0.55 });
      const result = await solveMechanismStudy(compiled, signal, ({ requestId, mechanismInputDigest }) => {
        emit({ progress: 0.6, partial: {
          kind: "mechanism-worker-started", requestId, mechanismInputDigest,
        } });
      });
      abort(signal);
      emit({ progress: 0.9 });
      const replay = await packReplay(request, result);
      abort(signal);
      return {
        output: result,
        truthLevel: "converged-numerical-solve",
        artifacts: [replay],
      };
    },
  };
}
