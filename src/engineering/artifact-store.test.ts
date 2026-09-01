import { describe, expect, it } from "vitest";

import { createArtifactIndex, defineArtifactRecord } from "../cad/artifact-contract";
import { invalidateArtifacts } from "../cad/artifact-invalidation";
import {
  createArtifactStore,
  digestArtifactPayload,
  synchronizeArtifactStoreInvalidation,
} from "./artifact-store";

const sourceRevision = "a".repeat(64);

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer as ArrayBuffer;
}

async function artifactFor(
  payload: ArrayBuffer | Readonly<Record<string, ArrayBufferView>>,
  dependencies: readonly unknown[] = [],
) {
  return defineArtifactRecord({
    kind: "field",
    sourceRevision,
    producer: { name: "structural-adapter", version: "1.0.0" },
    settingsDigest: "b".repeat(64),
    contentDigest: await digestArtifactPayload(payload),
    units: "m",
    mediaType: "application/vnd.engineering.field",
    dependencies,
  });
}

function viewValues(view: ArrayBufferView): number[] {
  return Array.from(new Float32Array(view.buffer, view.byteOffset, view.byteLength / Float32Array.BYTES_PER_ELEMENT));
}

describe("artifact payload store", () => {
  it("hashes raw payload bytes directly and structured views deterministically", async () => {
    const offsetBacking = new Uint8Array([0, 7, 8]);
    const offsetView = offsetBacking.subarray(1);
    const zeroOffsetView = new Uint8Array([7, 8]);
    const first = { stress: new Float32Array([1, 2]), displacement: offsetView };
    const reordered = { displacement: offsetView, stress: new Float32Array([1, 2]) };

    expect(await digestArtifactPayload(bytes(1, 2, 3)))
      .toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
    expect(await digestArtifactPayload(first)).toBe(await digestArtifactPayload(reordered));
    expect(await digestArtifactPayload({ displacement: zeroOffsetView, stress: new Float32Array([1, 2]) }))
      .not.toBe(await digestArtifactPayload(first));
    expect(await digestArtifactPayload({ stress: new Int32Array([1, 2]), displacement: offsetView }))
      .not.toBe(await digestArtifactPayload(first));
  });

  it("rejects digest mismatches before retaining a payload", async () => {
    const store = createArtifactStore();
    const payload = bytes(1, 2, 3);
    const record = await defineArtifactRecord({
      kind: "field",
      sourceRevision,
      producer: { name: "structural-adapter", version: "1.0.0" },
      settingsDigest: "b".repeat(64),
      contentDigest: "f".repeat(64),
      units: "m",
      mediaType: "application/vnd.engineering.field",
      dependencies: [],
    });

    await expect(store.put(record, payload)).rejects.toMatchObject({ code: "content-digest-mismatch" });
    await expect(store.get(record.id)).resolves.toBeUndefined();
  });

  it("owns fresh payload copies, makes duplicate puts idempotent, and rejects unsafe aliases", async () => {
    const store = createArtifactStore();
    const payload = { displacement: new Float32Array([1.5, 2.5]) };
    const record = await artifactFor(payload);

    await store.put(record, payload);
    await store.put(record, payload);
    payload.displacement[0] = 99;
    const firstRead = await store.get(record.id);
    if (!firstRead || firstRead instanceof ArrayBuffer || ArrayBuffer.isView(firstRead)) {
      throw new Error("Expected structured artifact payload");
    }
    (firstRead.displacement as Float32Array)[0] = 55;
    const secondRead = await store.get(record.id);
    if (!secondRead || secondRead instanceof ArrayBuffer || ArrayBuffer.isView(secondRead)) {
      throw new Error("Expected structured artifact payload");
    }

    expect(viewValues(secondRead.displacement)).toEqual([1.5, 2.5]);
    expect(firstRead.displacement.buffer).not.toBe(secondRead.displacement.buffer);

    const backing = new ArrayBuffer(8);
    await expect(digestArtifactPayload({
      first: new Uint8Array(backing, 0, 4),
      second: new Uint8Array(backing, 4, 4),
    })).rejects.toThrow(/alias/i);
    await expect(digestArtifactPayload({ shared: new Uint8Array(new SharedArrayBuffer(4)) }))
      .rejects.toThrow(/shared/i);
    const resizable = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]) as ArrayBuffer;
    await expect(digestArtifactPayload(resizable)).rejects.toThrow(/resizable/i);
  });

  it("rejects a structured duplicate that collides with a raw-byte digest", async () => {
    const store = createArtifactStore();
    const raw = bytes(...new TextEncoder().encode("artifact-view-map:1:0"));
    const structured = {} as Readonly<Record<string, ArrayBufferView>>;
    const record = await artifactFor(raw);

    expect(await digestArtifactPayload(structured)).toBe(await digestArtifactPayload(raw));
    await store.put(record, raw);
    await expect(store.put(record, structured)).rejects.toMatchObject({ code: "duplicate-artifact-id" });
    await expect(store.get(record.id)).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("does not expose any validated batch payload when its commit guard rejects", async () => {
    const store = createArtifactStore();
    const firstPayload = bytes(4);
    const secondPayload = bytes(5);
    const first = await artifactFor(firstPayload);
    const second = await artifactFor(secondPayload);

    await expect(store.commit([
      { record: first, payload: firstPayload }, { record: second, payload: secondPayload },
    ], () => false)).rejects.toMatchObject({ code: "commit-guard-rejected" });
    await expect(store.get(first.id)).resolves.toBeUndefined();
    await expect(store.get(second.id)).resolves.toBeUndefined();
  });

  it("deletes payloads selected by authoritative metadata invalidation only", async () => {
    const store = createArtifactStore();
    const invalidatedPayload = bytes(1);
    const retainedPayload = bytes(2);
    const invalidated = await artifactFor(invalidatedPayload, [{
      kind: "entity",
      reference: "parameter:width",
    }]);
    const retained = await artifactFor(retainedPayload, [{
      kind: "entity",
      reference: "frame:world",
    }]);
    const index = createArtifactIndex(sourceRevision, [invalidated, retained]);

    await store.put(invalidated, invalidatedPayload);
    await store.put(retained, retainedPayload);
    const invalidation = invalidateArtifacts(index, ["parameter:width"], "c".repeat(64));
    await synchronizeArtifactStoreInvalidation(store, invalidation);

    await expect(store.get(invalidated.id)).resolves.toBeUndefined();
    await expect(store.get(retained.id)).resolves.toBeInstanceOf(ArrayBuffer);
  });
});
