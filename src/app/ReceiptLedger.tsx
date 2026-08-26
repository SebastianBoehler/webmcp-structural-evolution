import type { ActionReceipt } from "../domain/receipts";

export interface ReceiptLedgerProps {
  readonly receipts: readonly ActionReceipt[];
}

interface ReceiptIdentity {
  readonly parent: string;
  readonly proposal: string;
  readonly branch: string;
  readonly attempt: string;
}

interface ReceiptSummary {
  readonly title: string;
  readonly badge: string;
  readonly description: string;
  readonly tone: "success" | "danger" | "neutral";
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function textField(value: unknown, key: string): string | undefined {
  const candidate = field(value, key);
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function receiptIdentity(receipt: ActionReceipt): ReceiptIdentity {
  const result = receipt.outcome.status === "succeeded" ? receipt.outcome.result : undefined;
  const text = (key: string) => textField(receipt.validatedInputs, key)
    ?? textField(result, key)
    ?? "not recorded";
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

function humanAction(action: string): string {
  return action.split("_").filter(Boolean).map((word) =>
    `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

function probeTitle(receipt: ActionReceipt): string {
  const variant = textField(receipt.validatedInputs, "variant");
  if (variant === "baseline") return "Baseline verification";
  if (variant === "edge-biased") return "Edge alternative";
  if (variant === "center-biased") return "Center alternative";
  return "Design verification";
}

function successfulDescription(receipt: ActionReceipt): string {
  switch (receipt.action) {
    case "run_foundation_probe":
      return textField(receipt.validatedInputs, "variant") === "baseline"
        ? "The baseline passed the exact verification check."
        : "A verified topology alternative is ready for human review.";
    case "promote_branch": return "The verified branch is now the active design.";
    case "compare_foundation_probes": return "Two verified alternatives were compared using measured results.";
    case "inspect_design_context": return "The agent inspected the current selection, locks, and assembly context.";
    case "human_intervention": return "The selected region and engineering locks were applied to the design context.";
    case "cancel_foundation_probe": return "The active verification stopped without changing the accepted design.";
    default: return "The action completed and its exact receipt was preserved.";
  }
}

function receiptSummary(receipt: ActionReceipt): ReceiptSummary {
  const title = receipt.action === "run_foundation_probe" ? probeTitle(receipt)
    : receipt.action === "promote_branch" ? "Design promotion"
      : receipt.action === "compare_foundation_probes" ? "Alternative comparison"
        : receipt.action === "inspect_design_context" ? "Design context inspection"
          : receipt.action === "human_intervention" ? "Design constraints updated"
            : receipt.action === "cancel_foundation_probe" ? "Verification cancellation"
              : humanAction(receipt.action);
  if (receipt.outcome.status === "failed") {
    return { title, badge: "Failed", description: receipt.outcome.error, tone: "danger" };
  }
  if (receipt.outcome.status === "canceled") {
    return { title, badge: "Canceled", description: receipt.outcome.reason, tone: "neutral" };
  }
  return {
    title,
    badge: receipt.action === "run_foundation_probe" ? "Verified" : "Completed",
    description: successfulDescription(receipt),
    tone: "success",
  };
}

function formattedTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(iso));
}

function formattedJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function ReceiptLedger({ receipts }: ReceiptLedgerProps) {
  return (
    <section className="receipt-ledger" aria-labelledby="receipt-ledger-title">
      <header className="receipt-ledger-heading">
        <div><h2 id="receipt-ledger-title">Activity</h2><p>Human actions and verified agent work.</p></div>
        <span>{receipts.length} {receipts.length === 1 ? "event" : "events"}</span>
      </header>
      <ol className="receipt-list" role="log" aria-label="Action receipts" aria-live="polite">
        {[...receipts].reverse().map((receipt) => {
          const identity = receiptIdentity(receipt);
          const summary = receiptSummary(receipt);
          return <li className="receipt-card" data-tone={summary.tone} key={receipt.id}>
            <div className="receipt-card-heading">
              <span className="receipt-state" aria-hidden="true" />
              <div><h3>{summary.title}</h3><p>{summary.description}</p></div>
              <div className="receipt-meta">
                <span>{summary.badge}</span>
                <small>{Math.max(1, Math.round(receipt.duration.value))} ms</small>
              </div>
            </div>
            <details className="receipt-technical">
              <summary>Technical receipt</summary>
              <dl>
                <div><dt>Action</dt><dd><code>{receipt.action}</code></dd></div>
                <div><dt>Recorded</dt><dd><time dateTime={receipt.createdAt}>{formattedTime(receipt.createdAt)}</time></dd></div>
                <div><dt>Affected revision</dt><dd><code>{receipt.affectedRevision ?? "none"}</code></dd></div>
                <div><dt>Parent</dt><dd><code>{identity.parent}</code></dd></div>
                <div><dt>Proposal</dt><dd><code>{identity.proposal}</code></dd></div>
                <div><dt>Branch</dt><dd><code>{identity.branch}</code></dd></div>
                <div><dt>Attempt</dt><dd>{identity.attempt}</dd></div>
              </dl>
              <p>Validated input</p>
              <pre><code>{formattedJson(receipt.validatedInputs)}</code></pre>
              {receipt.outcome.status === "succeeded" && <>
                <p>Result</p><pre><code>{formattedJson(receipt.outcome.result)}</code></pre>
              </>}
            </details>
          </li>;
        })}
      </ol>
    </section>
  );
}
