import { useMemo, useState } from "react";

import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";

const fixture = DRONE_ARM_FOUNDATION_STUDY;

const componentNames: Readonly<Record<string, string>> = {
  "motor-2207": "2207 brushless motor",
  "m3-fastener": "M3 × 12 fasteners",
  "body-interface": "Frame interface",
};

export interface ComponentBrowserProps {
  readonly selectedId: string;
  readonly open: boolean;
  readonly onSelect: (componentId: string) => void;
  readonly onClose: () => void;
}

export function ComponentBrowser({ selectedId, open, onSelect, onClose }: ComponentBrowserProps) {
  const [query, setQuery] = useState("");
  const components = useMemo(() => fixture.components.filter((component) => {
    const name = componentNames[component.id] ?? component.id;
    return `${name} ${component.category} ${component.partNumber}`.toLowerCase().includes(query.toLowerCase());
  }), [query]);

  const stockFor = (revision: string) => fixture.inventory.find(
    (item) => item.componentRevision === revision,
  )?.ownedQuantity ?? 0;
  const requiredFor = (revision: string) => fixture.assembly.components.find(
    (item) => item.componentRevision === revision,
  )?.quantity ?? 0;

  return (
    <aside className="side-panel component-browser" data-open={open} aria-label="Assembly components">
      <div className="panel-heading">
        <div><h2>Assembly</h2><p>Drone motor arm</p></div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close components">×</button>
      </div>
      <label className="search-field">
        <span className="visually-hidden">Find a component</span>
        <input
          type="search"
          value={query}
          placeholder="Find a component"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <nav className="component-list" aria-label="Assembly tree">
        <button
          className="component-row"
          type="button"
          data-selected={selectedId === "arm-design-region"}
          aria-pressed={selectedId === "arm-design-region"}
          onClick={() => onSelect("arm-design-region")}
        >
          <span className="part-mark part-mark--region" aria-hidden="true" />
          <span><strong>Arm design region</strong><small>Generated structure</small></span>
          <span className="stock-badge stock-badge--ready">Ready</span>
        </button>
        {components.map((component) => {
          const stock = stockFor(component.revision);
          const required = requiredFor(component.revision);
          const enough = stock >= required;
          return (
            <button
              className="component-row"
              type="button"
              key={component.id}
              data-selected={selectedId === component.id}
              aria-pressed={selectedId === component.id}
              onClick={() => onSelect(component.id)}
            >
              <span className="part-mark" aria-hidden="true" />
              <span><strong>{componentNames[component.id] ?? component.id}</strong><small>{component.category}</small></span>
              <span className={`stock-badge ${enough ? "stock-badge--ready" : "stock-badge--short"}`}>
                {stock}/{required}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="inventory-summary">
        <span>Inventory</span>
        <strong>{fixture.inventory.reduce((total, item) => total + item.ownedQuantity, 0)} parts</strong>
        <p>One M3 fastener is required before this assembly is buildable.</p>
      </div>
    </aside>
  );
}
