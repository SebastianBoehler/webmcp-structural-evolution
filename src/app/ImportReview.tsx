import type { PendingComponentImport } from "../assembly/component-import";

export interface ImportReviewProps {
  readonly pending: PendingComponentImport;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

export function ImportReview({ pending, onApprove, onReject }: ImportReviewProps) {
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
      <div className="import-review__actions">
        <button type="button" onClick={onReject}>Reject</button>
        <button className="primary-action" type="button" onClick={onApprove}>Add to assembly</button>
      </div>
    </section>
  );
}
