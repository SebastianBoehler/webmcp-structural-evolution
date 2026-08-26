import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import type { FoundationProjectState } from "../webmcp/schemas";
import { EvidencePanel } from "./EvidencePanel";

const revision = (value: string) => value.repeat(64);

test("shows a newest mismatch before separately labelled historical verification", () => {
  const state: FoundationProjectState = {
    contextRevision: revision("a"),
    acceptedBranchRevision: revision("a"),
    selection: { id: "arm", label: "Arm" },
    locks: ["body"],
    capability: { status: "available", message: "ready" },
    operationStatus: "idle",
    receipts: [],
    stagedBranches: [
      {
        parentRevision: revision("a"), proposalRevision: revision("p"), branchRevision: revision("b"), variant: "baseline",
        hypothesis: "Verify baseline field", prediction: "Verification should pass",
        attempt: 1, stale: false, status: "verified",
        measurement: { status: "verified", elapsedMs: 8, relativeL2: 0, resultDigest: revision("d") },
      },
      {
        parentRevision: revision("a"), proposalRevision: revision("q"), branchRevision: revision("c"), variant: "edge-biased",
        hypothesis: "Verify edge field", prediction: "Verification should pass",
        attempt: 1, stale: false, status: "mismatch",
        measurement: {
          status: "mismatch", elapsedMs: 9, relativeL2: 0.2, resultDigest: revision("e"),
          code: "verification-mismatch", message: "Newest field disagreed with the oracle",
        },
      },
    ],
  };

  render(<EvidencePanel state={state} initialAcceptedRevision={revision("a")} />);

  expect(screen.getByRole("alert").textContent).toContain("Newest field disagreed with the oracle");
  expect(screen.getByText(/historical verification/i).textContent).toContain("baseline");
});
