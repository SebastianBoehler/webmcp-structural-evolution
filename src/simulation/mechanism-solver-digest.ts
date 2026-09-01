export async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const MECHANISM_SOLVER_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
const invalidSize = () => new Error("Mechanism solver artifact size is invalid");
const abort = (signal: AbortSignal) => {
  if (signal.aborted) throw signal.reason instanceof Error
    ? signal.reason : new DOMException("Mechanism solver artifact fetch was cancelled", "AbortError");
};

export async function fetchArtifactDigest(url: string, signal: AbortSignal): Promise<string> {
  abort(signal);
  const response = await fetch(url, { cache: "no-store", signal });
  abort(signal);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Mechanism solver artifact fetch failed: ${response.status}`);
  }
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null && /^\d+$/.test(contentLength)
    && Number(contentLength) > MECHANISM_SOLVER_ARTIFACT_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw invalidSize();
  }
  if (!response.body) throw invalidSize();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const onAbort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      abort(signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MECHANISM_SOLVER_ARTIFACT_MAX_BYTES) {
        await reader.cancel(invalidSize()).catch(() => undefined);
        throw invalidSize();
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  if (totalBytes === 0) throw invalidSize();
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  abort(signal);
  const digest = await sha256Bytes(bytes.buffer);
  abort(signal);
  return digest;
}
