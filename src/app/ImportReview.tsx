import { useState } from "react";

import type { PendingComponentImport } from "../assembly/component-import";

export interface ImportReviewProps {
  readonly pending: PendingComponentImport;
  readonly onApprove: () => void | Promise<void | string | undefined>;
  readonly onReject: () => void;
}

export function ImportReview({ pending, onApprove, onReject }: ImportReviewProps) {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string>();
  const approve = async () => {
    setApproving(true); setError(undefined);
    try { await onApprove(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setApproving(false); }
  };
  return (
    <section className="import-review" aria-labelledby="import-review-title">
      <div>
        <h2 id="import-review-title">Review sourced component</h2>
        <p>{pending.manufacturer} {pending.partNumber}</p>
      </div>
      <dl>
        <div><dt>Asset</dt><dd>{pending.assetUnits} · GLB/glTF</dd></div>
        <div><dt>Size</dt><dd>{pending.sizeMm.join(" × ")} mm</dd></div>
        <div><dt>Mass</dt><dd>{pending.massG} g</dd></div>
      </dl>
      <p className="import-review__boundary">The agent staged this file. Approval adds it as unverified reference geometry; it does not certify fit or loads.</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="import-review__actions">
        <button type="button" disabled={approving} onClick={onReject}>Reject</button>
        <button className="primary-action" type="button" disabled={approving} onClick={() => void approve()}>{approving ? "Adding…" : "Add to assembly"}</button>
      </div>
    </section>
  );
}
