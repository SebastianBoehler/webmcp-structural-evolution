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

export function ReceiptLedger({ receipts }: ReceiptLedgerProps) {
  return (
    <section aria-labelledby="receipt-ledger-title">
      <h2 id="receipt-ledger-title">Action receipts</h2>
      <ol role="log" aria-label="Action receipts" aria-live="polite">
        {receipts.map((receipt) => (
          <li key={receipt.id}>
            <p><strong>{receipt.action}</strong> · {receipt.createdAt}</p>
            <p>Affected revision: {receipt.affectedRevision ?? "none"}</p>
            <p>Validated input: <code>{boundedJson(receipt.validatedInputs)}</code></p>
            {receipt.outcome.status === "failed" ? <p role="alert">Failed: {receipt.outcome.error}</p>
              : receipt.outcome.status === "canceled" ? <p>Canceled: {receipt.outcome.reason}</p>
                : <>
                  <p>Succeeded in {receipt.duration.value.toFixed(2)} ms</p>
                  <p>Result: <code>{boundedJson(receipt.outcome.result)}</code></p>
                </>}
          </li>
        ))}
      </ol>
    </section>
  );
}
