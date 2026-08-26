import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  ["verified", "Verified", { status: "succeeded", result: { ...identity, status: "verified" } }],
  ["mismatch", "Failed", { status: "failed", error: "verification mismatch" }],
  ["failed", "Failed", { status: "failed", error: "device lost" }],
  ["canceled", "Canceled", { status: "canceled", reason: "invocation canceled" }],
] as const)("leads with a human summary and progressively discloses the exact %s receipt", (_status, badge, outcome) => {
  const receipt = defineActionReceipt({
    id: `receipt-${_status}`,
    action: "run_foundation_probe",
    validatedInputs: { ...identity, variant: "baseline", prediction: "x".repeat(400) },
    affectedRevision: identity.branchRevision,
    outcome,
    duration: { value: 1, unit: "ms" },
    createdAt: "2026-08-26T00:00:00.000Z",
  });
  render(<ReceiptLedger receipts={[receipt]} />);
  const item = screen.getByRole("listitem");

  expect(within(item).getByText("Baseline verification")).toBeVisible();
  expect(within(item).getByText(badge)).toBeVisible();
  const technical = within(item).getByText("Technical receipt").closest("details");
  expect(technical?.hasAttribute("open")).toBe(false);
  expect(technical?.contains(within(item).getByText("run_foundation_probe"))).toBe(true);
  expect(technical?.contains(within(item).getByText(identity.parentRevision))).toBe(true);

  fireEvent.click(within(item).getByText("Technical receipt"));
  expect(technical?.hasAttribute("open")).toBe(true);
  expect(within(item).getByText("run_foundation_probe")).toBeVisible();
  expect(within(item).getByText(identity.parentRevision)).toBeVisible();
  expect(within(item).getByText(identity.proposalRevision)).toBeVisible();
  expect(within(item).getAllByText(identity.branchRevision).length).toBeGreaterThan(0);
  expect(within(item).getByText("2")).toBeVisible();
  expect(item.textContent).toContain("x".repeat(400));
});
