import { useMemo, useRef, useState } from "react";

import type { AssemblyVisualPart } from "../viewer/render-envelope";

export interface ComponentBrowserProps {
  readonly selectedId: string;
  readonly open: boolean;
  readonly parts: readonly AssemblyVisualPart[];
  readonly revision?: string;
  readonly conflictCount?: number;
  readonly onSelect: (componentId: string) => void;
  readonly onImportFile: (file: File) => void | Promise<void>;
  readonly onReplaceDisplayFile: (componentId: string, file: File) => void | Promise<void>;
  readonly onClose: () => void;
}

export function ComponentBrowser({ selectedId, open, parts, revision, conflictCount = 0, onSelect, onImportFile, onReplaceDisplayFile, onClose }: ComponentBrowserProps) {
  const [query, setQuery] = useState("");
  const [importError, setImportError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const components = useMemo(() => parts.filter((part) =>
    part.appearance === "component" &&
    !part.id.startsWith("reference-arm") &&
    `${part.label} ${part.kind}`.toLowerCase().includes(query.toLowerCase())), [parts, query]);
  const importLocalFile = async (file: File) => {
    setImportError(undefined);
    try {
      await onImportFile(file);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Component import failed");
    }
  };
  const replaceDisplayFile = async (file: File) => {
    setImportError(undefined);
    try {
      await onReplaceDisplayFile(selectedId, file);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Display CAD replacement failed");
    }
  };
  const selectedComponent = components.some(({ selectionId }) => selectionId === selectedId);

  return (
    <aside className="side-panel component-browser" data-open={open} aria-label="Assembly components">
      <div className="panel-heading">
        <div><h2>Assembly</h2><p>{revision ? `Staged revision ${revision.slice(0, 8)}` : "Quadrotor frame"}</p></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Collapse components">×</button>
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
      <div
        className="inventory-summary"
        data-testid="component-import-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) void importLocalFile(file);
        }}
      >
        <span>Component library</span>
        <strong>{components.length} placed</strong>
        {revision ? <p>{conflictCount === 0 ? "No unresolved assembly conflicts." : `${conflictCount} unresolved assembly conflicts.`}</p> : null}
        <p>Drop a trusted local ZIP package, STEP, STP, GLB, or glTF. Files stay local; package integrity is verified before use.</p>
        {importError ? <p role="alert">{importError}</p> : null}
        <button type="button" disabled={!selectedComponent} onClick={() => replacementInputRef.current?.click()}>Replace selected display CAD</button>
        <input
          ref={replacementInputRef}
          className="visually-hidden"
          type="file"
          aria-label="Choose replacement display CAD"
          accept=".step,.stp,.glb,.gltf,model/gltf-binary,model/gltf+json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void replaceDisplayFile(file);
            event.target.value = "";
          }}
        />
        <button type="button" onClick={() => inputRef.current?.click()}>Import component file</button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          aria-label="Choose local component file"
          accept=".zip,.step,.stp,.glb,.gltf,application/zip,model/gltf-binary,model/gltf+json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importLocalFile(file);
            event.target.value = "";
          }}
        />
      </div>
    </aside>
  );
}
