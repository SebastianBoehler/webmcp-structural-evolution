import type { ActionReceipt } from "../domain/receipts";

export interface ReceiptLedgerProps {
  readonly receipts: readonly ActionReceipt[];
}

const RECEIPT_SUMMARY_LIMIT = 240;

function boundedJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized.length <= RECEIPT_SUMMARY_LIMIT
    ? serialized
    : `${serialized.slice(0, RECEIPT_SUMMARY_LIMIT - 1)}…`;
}

interface ReceiptIdentity {
  readonly parent: string;
  readonly proposal: string;
  readonly branch: string;
  readonly attempt: string;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function receiptIdentity(receipt: ActionReceipt): ReceiptIdentity {
  const result = receipt.outcome.status === "succeeded" ? receipt.outcome.result : undefined;
  const text = (key: string) => {
    const value = field(receipt.validatedInputs, key) ?? field(result, key);
    return typeof value === "string" && value.length > 0 ? value : "not recorded";
  };
  const attempt = field(receipt.validatedInputs, "attempt") ?? field(result, "attempt");
  const branch = text("branchRevision") === "not recorded"
    && /^(run|cancel)_foundation_probe$/.test(receipt.action)
    ? receipt.affectedRevision ?? "not recorded"
    : text("branchRevision");
  return {
    parent: text("parentRevision"),
    proposal: text("proposalRevision"),
    branch,
    attempt: typeof attempt === "number" ? String(attempt) : "not recorded",
  };
}

export function ReceiptLedger({ receipts }: ReceiptLedgerProps) {
  return (
    <section aria-labelledby="receipt-ledger-title">
      <h2 id="receipt-ledger-title">Action receipts</h2>
      <ol role="log" aria-label="Action receipts" aria-live="polite">
        {receipts.map((receipt) => {
          const identity = receiptIdentity(receipt);
          return <li key={receipt.id}>
            <p><strong>{receipt.action}</strong> · {receipt.createdAt}</p>
            <p>Affected revision: {receipt.affectedRevision ?? "none"}</p>
            <dl>
              <div><dt>Parent</dt><dd><code>{identity.parent}</code></dd></div>
              <div><dt>Proposal</dt><dd><code>{identity.proposal}</code></dd></div>
              <div><dt>Branch</dt><dd><code>{identity.branch}</code></dd></div>
              <div><dt>Attempt</dt><dd>{identity.attempt}</dd></div>
            </dl>
            <p>Validated input: <code>{boundedJson(receipt.validatedInputs)}</code></p>
            {receipt.outcome.status === "failed" ? <p role="alert">Failed: {receipt.outcome.error}</p>
              : receipt.outcome.status === "canceled" ? <p>Canceled: {receipt.outcome.reason}</p>
                : <>
                  <p>Succeeded in {receipt.duration.value.toFixed(2)} ms</p>
                  <p>Result: <code>{boundedJson(receipt.outcome.result)}</code></p>
                </>}
          </li>;
        })}
      </ol>
    </section>
  );
}
