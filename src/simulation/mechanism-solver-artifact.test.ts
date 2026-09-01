import { expect, test, vi } from "vitest";

import { readMechanismSolverWorkerArtifactDigest } from "./mechanism-solver-artifact";

test("hashes the exact emitted worker bytes addressed by the worker asset URL", async () => {
  const fetchArtifact = vi.fn().mockResolvedValue(new Response("worker-artifact", { status: 200 }));
  vi.stubGlobal("fetch", fetchArtifact);
  await expect(readMechanismSolverWorkerArtifactDigest(new AbortController().signal)).resolves
    .toBe("876c82768bebbd3567d4813fe4f08f85714a34e093228994bef03ef7982a5991");
  expect(fetchArtifact).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test("cancels an in-flight worker artifact fetch", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  })));
  const digest = readMechanismSolverWorkerArtifactDigest(controller.signal);
  controller.abort();
  await expect(digest).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
  vi.unstubAllGlobals();
});

test("cancels a chunked worker artifact stream as soon as it exceeds 64 MiB", async () => {
  const cancelled = vi.fn();
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(stream) { stream.enqueue(chunk); },
    cancel: cancelled,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
  await expect(readMechanismSolverWorkerArtifactDigest(new AbortController().signal))
    .rejects.toThrow("artifact size is invalid");
  expect(cancelled).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test("rejects an oversized Content-Length before consuming the artifact", async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200,
    headers: { "Content-Length": String(64 * 1024 * 1024 + 1) } })));
  await expect(readMechanismSolverWorkerArtifactDigest(new AbortController().signal))
    .rejects.toThrow("artifact size is invalid");
  expect(cancelled).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
