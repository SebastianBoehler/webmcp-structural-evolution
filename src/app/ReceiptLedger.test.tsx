import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { defineActionReceipt } from "../domain/receipts";
import { ReceiptLedger } from "./ReceiptLedger";

const identity = {
  parentRevision: "a".repeat(64),
  proposalRevision: "b".repeat(64),
  branchRevision: "c".repeat(64),
  attempt: 2,
};

afterEach(cleanup);

test.each([
  ["verified", { status: "succeeded", result: { ...identity, status: "verified" } }],
  ["mismatch", { status: "failed", error: "verification mismatch" }],
  ["failed", { status: "failed", error: "device lost" }],
  ["canceled", { status: "canceled", reason: "invocation canceled" }],
] as const)("renders exact identity before the bounded %s receipt summary", (_status, outcome) => {
  const receipt = defineActionReceipt({
    id: `receipt-${_status}`,
    action: "run_foundation_probe",
    validatedInputs: { ...identity, prediction: "x".repeat(400) },
    affectedRevision: identity.branchRevision,
    outcome,
    duration: { value: 1, unit: "ms" },
    createdAt: "2026-08-26T00:00:00.000Z",
  });
  render(<ReceiptLedger receipts={[receipt]} />);
  const item = screen.getByRole("listitem");

  expect(within(item).getByText(identity.parentRevision)).toBeVisible();
  expect(within(item).getByText(identity.proposalRevision)).toBeVisible();
  expect(within(item).getAllByText(identity.branchRevision).length).toBeGreaterThan(0);
  expect(within(item).getByText("2")).toBeVisible();
  expect(item.textContent).toMatch(/Validated input:.*…/);
});
