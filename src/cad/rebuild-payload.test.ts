import { describe, expect, it } from "vitest";

import { CAD_RESOURCE_LIMITS } from "./cad-resource-limits";
import { digestCadOutputPayload, SemanticMeshPayloadSchema } from "./rebuild-payload";

describe("CAD output resource limits", () => {
  it("rejects canonical digest input before allocating an over-budget combined buffer", async () => {
    const block = new Uint8Array(1024 * 1024);
    const blocks = Array.from({
      length: Math.floor(CAD_RESOURCE_LIMITS.canonicalDigestBytes / block.byteLength) + 1,
    }, () => block);

    await expect(digestCadOutputPayload(blocks)).rejects.toMatchObject({
      code: "resource-limit",
    });
  });

  it("validates semantic indices with bounded indexed iteration", () => {
    const mesh = {
      positionsM: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 0, 1]),
      indices: new Uint32Array([0, 1, 0]),
      faces: [{
        id: "face-1", bodyId: "body-1",
        signature: {
          ownerFeatureId: "base", kind: "face", geometry: "plane",
          centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [],
        },
      }],
      triangleFaceIndices: new Uint32Array([0]),
      edgePointsM: new Float32Array(), edgePointRanges: new Uint32Array(),
      edges: [], polylineEdgeIndices: new Uint32Array(),
    };

    expect(() => SemanticMeshPayloadSchema.parse(mesh)).toThrow(/unavailable vertex/i);
  });

  it("rejects raw over-budget topology before traversing a record", () => {
    const record = {
      id: "face-1", bodyId: "body-1",
      signature: {
        ownerFeatureId: "base", kind: "face", geometry: "plane",
        centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [],
      },
    };
    let recordReads = 0;
    const faces = new Proxy(
      Array.from({ length: CAD_RESOURCE_LIMITS.semanticMeshTopologyRecords + 1 }, () => record),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) recordReads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const mesh = {
      positionsM: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(),
      faces, triangleFaceIndices: new Uint32Array(), edgePointsM: new Float32Array(),
      edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
    };

    expect(() => SemanticMeshPayloadSchema.parse(mesh)).toThrow(/semantic topology records/i);
    expect(recordReads).toBe(0);
  });
});
