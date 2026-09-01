import type { JSX } from "react";
import type { ShowcaseModelEvidence as ShowcaseModelEvidenceValue } from "../workspace/component-showcase-evidence";

export function ShowcaseModelEvidence({ models }: {
  readonly models: readonly ShowcaseModelEvidenceValue[];
}): JSX.Element {
  return <section className="showcase-model-evidence" aria-label="Component model authority">
    {models.map((model) => <dl key={model.modelId}>
      <div><dt>Model</dt><dd>{model.modelId}</dd></div>
      <div><dt>Authority</dt><dd>{model.authority}</dd></div>
      <div><dt>Source revision</dt><dd>{model.sourceRevision}</dd></div>
      <div><dt>Coverage</dt><dd>{model.componentCount} components · {model.bodyCount} bodies</dd></div>
      <div><dt>State</dt><dd>{model.state}</dd></div>
    </dl>)}
  </section>;
}
