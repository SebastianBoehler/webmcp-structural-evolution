import { expect, it, vi } from "vitest";

import { exportWorkspaceArtifact } from "./workspace-authority";
import { cadResult } from "./workspace-test-fixtures";
import { sourceDocument } from "../engineering/job-runner-test-fixtures";
import type { ExportApproval } from "./workspace-inspection";

it("atomically reserves an export nonce while approval verification is pending", async () => {
  const document = await sourceDocument();
  const event = await cadResult({
    requestId: "approval-race", document, sourceRevision: document.revision,
    requestedOutputs: ["step"],
  });
  const result = event.results[0];
  if (!("artifact" in result) || result.output !== "step") throw new Error("Expected export artifact");
  const artifact = result.artifact;
  const approval: ExportApproval = {
    operation: "export-artifact", artifactId: artifact.id,
    headRevision: document.revision, sourceRevision: artifact.sourceRevision,
    contentDigest: artifact.contentDigest, mediaType: artifact.mediaType,
    issuedBy: { kind: "human", id: "sebastian" }, nonce: "same-nonce",
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const verify = vi.fn(async () => { await gate; return true; });
  const used = new Set<string>();
  const args = [artifact.id, approval, document.revision, [artifact],
    new Map([[artifact.id, result.payload.bytes]]), used, verify, () => true] as const;

  const first = exportWorkspaceArtifact(...args);
  const second = exportWorkspaceArtifact(...args);
  await Promise.resolve();
  release();

  const settled = await Promise.allSettled([first, second]);
  expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
  expect(verify).toHaveBeenCalledOnce();
});
