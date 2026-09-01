// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { sourceDocument } from "../engineering/job-runner-test-fixtures";
import { createExactComponentSourceLease } from "./exact-component-source-lease";
import type { ExactComponentSource } from "./exact-component-source";

describe("exact component source lease", () => {
  it("shares one acquisition within a revision and reacquires after invalidation", async () => {
    const document = await sourceDocument();
    const source = { sourceRevision: document.revision } as ExactComponentSource;
    const signals: AbortSignal[] = [];
    const acquire = vi.fn(async (_document, signal: AbortSignal) => {
      signals.push(signal);
      return source;
    });
    const retain = vi.fn(async () => undefined);
    const lease = createExactComponentSourceLease(acquire, retain);

    await Promise.all([lease.get(document), lease.get(document)]);
    expect(acquire).toHaveBeenCalledOnce();
    expect(retain).toHaveBeenCalledTimes(2);

    lease.invalidate();
    expect(signals[0]!.aborted).toBe(true);
    await lease.get(document);
    expect(acquire).toHaveBeenCalledTimes(2);
  });
});
