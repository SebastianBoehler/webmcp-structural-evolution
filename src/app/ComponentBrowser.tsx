import { useMemo, useRef, useState } from "react";

import type { AssemblyVisualPart } from "../viewer/render-envelope";

export interface ComponentBrowserProps {
  readonly selectedId: string;
  readonly open: boolean;
  readonly parts: readonly AssemblyVisualPart[];
  readonly onSelect: (componentId: string) => void;
  readonly onImportFile: (file: File) => void | Promise<void>;
  readonly onClose: () => void;
}

export function ComponentBrowser({ selectedId, open, parts, onSelect, onImportFile, onClose }: ComponentBrowserProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const components = useMemo(() => parts.filter((part) =>
    part.appearance === "component" &&
    !part.id.startsWith("reference-arm") &&
    `${part.label} ${part.kind}`.toLowerCase().includes(query.toLowerCase())), [parts, query]);

  return (
    <aside className="side-panel component-browser" data-open={open} aria-label="Assembly components">
      <div className="panel-heading">
        <div><h2>Assembly</h2><p>Quadrotor frame</p></div>
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
          <span><strong>Frame design space</strong><small>Topology-optimized structure</small></span>
          <span className="stock-badge stock-badge--ready">Ready</span>
        </button>
        {components.map((component) => (
            <button
              className="component-row"
              type="button"
              key={component.id}
              data-selected={selectedId === component.selectionId}
              aria-pressed={selectedId === component.selectionId}
              onClick={() => onSelect(component.selectionId)}
            >
              <span className="part-mark" aria-hidden="true" />
              <span><strong>{component.label}</strong><small>{component.kind}</small></span>
              <span className="stock-badge stock-badge--ready">Placed</span>
            </button>
        ))}
      </nav>
      <div className="inventory-summary">
        <span>Component library</span>
        <strong>{components.length} placed</strong>
        <p>Import STEP, STP, GLB, or glTF. CAD geometry stays local; engineering metadata remains unverified.</p>
        <button type="button" onClick={() => inputRef.current?.click()}>Import component file</button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".step,.stp,.glb,.gltf,model/gltf-binary,model/gltf+json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onImportFile(file);
            event.target.value = "";
          }}
        />
      </div>
    </aside>
  );
}
