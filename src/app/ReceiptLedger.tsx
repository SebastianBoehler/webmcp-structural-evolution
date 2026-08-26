import type { ActionReceipt } from "../domain/receipts";

export interface ReceiptLedgerProps {
  readonly receipts: readonly ActionReceipt[];
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
            {receipt.outcome.status === "failed"
              ? <p role="alert">Failed: {receipt.outcome.error}</p>
              : <p>Succeeded in {receipt.duration.value.toFixed(2)} ms</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
