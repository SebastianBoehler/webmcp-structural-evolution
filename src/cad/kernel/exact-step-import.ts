import type { OcctKernel, ShapeHandle } from "occt-wasm";

import { revisionId } from "../../domain/revisions";
import { defineArtifactRecord } from "../artifact-contract";
import { digestCadOutputPayload, type MassPropertiesPayload } from "../rebuild-payload";
import type { ExactStepImportRequest, ExactStepImportResult } from "../runtime-contracts";
import type { OcctBridge } from "./occt-bridge";
import { importStepBytes } from "./step-exchange";

const abortIfRequested = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Exact STEP import was cancelled", "AbortError");
};

function massProperties(kernel: OcctKernel, shape: ShapeHandle): MassPropertiesPayload {
  const center = kernel.getCenterOfMass(shape);
  const inertia = kernel.getInertia(shape);
  if (inertia.length !== 9) throw new Error("OCCT returned an invalid STEP inertia tensor");
  const volumeM3 = kernel.getVolume(shape);
  return {
    densityKgM3: 1, volumeM3, surfaceAreaM2: kernel.getSurfaceArea(shape), massKg: volumeM3,
    centerOfMassM: [center.x, center.y, center.z],
    inertiaKgM2: inertia as MassPropertiesPayload["inertiaKgM2"],
  };
}

export async function importExactStep(
  bridge: OcctBridge,
  request: ExactStepImportRequest,
  signal: AbortSignal,
): Promise<ExactStepImportResult> {
  abortIfRequested(signal);
  return bridge.withKernel(async (kernel) => {
    const shape = importStepBytes(kernel, request.step.payload.bytes);
    try {
      abortIfRequested(signal);
      const bounds = kernel.getBoundingBox(shape, false);
      const payload = { bytes: kernel.toBREPBinary(shape) };
      const artifact = await defineArtifactRecord({
        kind: "brep", sourceRevision: request.sourceRevision,
        producer: { name: "occt-wasm", version: "4.3.2" },
        settingsDigest: await revisionId({ operation: "exact-step-import", settings: request.settings }),
        contentDigest: await digestCadOutputPayload(payload), units: "m",
        mediaType: "application/vnd.opencascade.brep",
        dependencies: [{ kind: "artifact", artifactId: request.step.artifact.id }],
      });
      abortIfRequested(signal);
      return {
        requestId: request.requestId, sourceRevision: request.sourceRevision,
        sourceArtifactId: request.step.artifact.id, artifact, payload,
        massProperties: massProperties(kernel, shape),
        envelopeM: {
          minimum: [bounds.xmin, bounds.ymin, bounds.zmin],
          maximum: [bounds.xmax, bounds.ymax, bounds.zmax],
        },
        solidCount: 1, invalidSolidCount: 0,
      };
    } finally {
      kernel.release(shape);
    }
  });
}
