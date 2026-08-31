import { expect, it } from "vitest";

import { captureEngineeringSolveRequest } from "./job-request-snapshot";
import { request, sourceDocument } from "./job-runner-test-fixtures";

it("owns immutable solve identity, settings, input, and document snapshots", async () => {
  const document = await sourceDocument();
  const revised = await sourceDocument("Revised link");
  const requestValue = await request(document, "snapshot-copy");
  const snapshot = captureEngineeringSolveRequest(requestValue);
  const mutable = requestValue as unknown as {
    jobId: string;
    kind: "thermal";
    sourceRevision: string;
    document: typeof revised;
    settings: { changed: boolean };
    input: { grid: [number, number, number] };
  };
  mutable.jobId = "mutated-job-id";
  mutable.kind = "thermal";
  mutable.sourceRevision = revised.revision;
  mutable.document = revised;
  mutable.settings = { changed: true };
  mutable.input = { grid: [99, 99, 99] };

  expect(snapshot).toMatchObject({
    jobId: "snapshot-copy", kind: "fea", sourceRevision: document.revision,
    document: { revision: document.revision }, settings: {}, input: { grid: [8, 4, 2] },
  });
  expect(Object.isFrozen(snapshot)).toBe(true);
});
