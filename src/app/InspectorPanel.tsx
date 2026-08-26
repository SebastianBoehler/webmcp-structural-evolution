import type { ImportedComponent } from "../assembly/component-import";
import type { AssemblyDraft } from "../domain/assembly-model";
import type { ComponentDefinition } from "../domain/component-model";
import type { FoundationContextSnapshot } from "../domain/foundation-context";
import type { AssemblyVisualPart } from "../viewer/render-envelope";

export interface InspectorPanelProps {
  readonly selectedId: string;
  readonly context: FoundationContextSnapshot;
  readonly parts: readonly AssemblyVisualPart[];
  readonly imports: readonly ImportedComponent[];
  readonly assembly?: Pick<AssemblyDraft, "components">;
  readonly catalog?: readonly ComponentDefinition[];
  readonly conflicts?: readonly { readonly id: string; readonly message?: string; readonly instanceIds?: readonly string[] }[];
  readonly layoutState: "verified" | "dragging" | "changed";
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onLockCableClearance: () => void;
  readonly onMovePart: (id: string, center: readonly [number, number, number]) => void;
}

function PositionEditor({ part, onMove }: {
  readonly part: AssemblyVisualPart;
  readonly onMove: (id: string, center: readonly [number, number, number]) => void;
}) {
  const [coordinates, setCoordinates] = useState(() => part.center.map(String));
  useEffect(() => setCoordinates(part.center.map(String)), [part.center]);
  const values = coordinates.map(Number);
  const valid = values.length === 3 && values.every(Number.isFinite);
  return (
    <section className="position-editor" aria-label="Exact component position">
      <div><h3>Position</h3><p>World coordinates · millimetres</p></div>
      <div className="position-fields">
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <label key={axis}><span>{axis}</span><input
            aria-label={`${axis} position`}
            type="number"
            step="1"
            value={coordinates[index] ?? ""}
            onChange={(event) => setCoordinates((current) => current.map(
              (value, currentIndex) => currentIndex === index ? event.target.value : value,
            ))}
          /></label>
        ))}
      </div>
      <button type="button" disabled={!valid} onClick={() => {
        if (valid) onMove(part.selectionId, values as [number, number, number]);
      }}>Apply exact position</button>
    </section>
  );
}

const knownDetails = (part: AssemblyVisualPart | undefined) => {
  if (!part) return undefined;
  if (part.kind === "motor") return {
    category: "Brushless motor",
    manufacturer: "Hobbywing",
    partNumber: "XRotor-2207.5SL-1780KV",
    mass: "38 g",
    source: "https://www.hobbywing.com/en/products/xrotor-22075",
    fit: "Ø16 mm bolt circle · 4 × M3",
  };
  if (part.kind === "propeller") return {
    category: "Rotor",
    manufacturer: "HQProp",
    partNumber: "HQ5X4.3X3V2S-PC",
    mass: "3.8 g",
    source: "https://www.hqprop.com/hq-freestyle-prop-5x43x3v2s-2cw2ccw-poly-carbonate-p0233.html",
    fit: "127 mm · 5 mm hub",
  };
  if (part.id === "frame-core") return {
    category: "Frame interface",
    manufacturer: "Sunderlabs",
    partNumber: "FRAME-CORE-01",
    mass: "Not measured",
    fit: "52 × 52 × 8 mm envelope",
  };
  return undefined;
};

export function InspectorPanel({
  selectedId,
  context,
  parts,
  imports,
  assembly,
  catalog = [],
  conflicts = [],
  layoutState,
  open,
  onClose,
  onLockCableClearance,
  onMovePart,
}: InspectorPanelProps) {
  const part = parts.find((candidate) => candidate.selectionId === selectedId);
  const imported = imports.find((candidate) => candidate.id === selectedId);
  const instance = assembly?.components.find(({ instanceId }) => instanceId === selectedId);
  const definition = catalog.find(({ revision }) => revision === instance?.componentRevision);
  const canonicalDetails = definition ? {
    category: definition.category.replaceAll("-", " "), manufacturer: definition.manufacturer,
    partNumber: definition.partNumber, mass: `${definition.mass.value * 1_000} g`,
    source: definition.provenance.sources[0]?.reference,
    fit: `${definition.mountInterfaces.length + definition.interfaces.length} declared interfaces`,
  } : undefined;
  const details = canonicalDetails ?? knownDetails(part);
  const selectedConflicts = conflicts.filter(({ instanceIds }) => instanceIds?.includes(selectedId));
  const isRegion = selectedId === "arm-design-region";
  const isConstraint = part?.appearance === "constraint";

  return (
    <aside className="side-panel inspector-panel" data-open={open} aria-label="Selection inspector">
      <div className="panel-heading">
        <div><h2>Inspector</h2><p>{layoutState === "verified" ? "Assembly aligned" : layoutState === "dragging" ? "Moving component" : "Verification required"}</p></div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close inspector">×</button>
      </div>
      <div className="selection-heading">
        <span className="selection-icon" aria-hidden="true" />
        <div><h3>{part?.label ?? selectedId}</h3><p>{details?.category ?? imported?.category ?? (isRegion ? "Topology domain" : "Protected geometry")}</p></div>
      </div>

      {(details || imported) && (
        <dl className="property-list">
          <div><dt>Maker</dt><dd>{details?.manufacturer ?? imported?.manufacturer}</dd></div>
          <div><dt>Part</dt><dd>{details?.partNumber ?? imported?.partNumber}</dd></div>
          <div><dt>Mass</dt><dd>{details?.mass ?? `${imported?.massG} g`}</dd></div>
          <div><dt>Interface</dt><dd>{details?.fit ?? `${imported?.sizeMm.join(" × ")} mm`}</dd></div>
          {part?.movable && <div><dt>Position</dt><dd>{part.center.slice(0, 2).map(Math.round).join(", ")} mm</dd></div>}
        </dl>
      )}
      {isRegion && (
        <dl className="property-list">
          <div><dt>Resolution</dt><dd>{Object.values(context.grid.dimensions).join(" × ")} voxels</dd></div>
          <div><dt>Objective</dt><dd>Minimum compliance · 35% volume</dd></div>
          <div><dt>Status</dt><dd>{layoutState === "verified" ? "Evidence current" : "Layout changed"}</dd></div>
        </dl>
      )}
      {isConstraint && <p className="inspector-note">This safety zone follows its motor and remains excluded from generated structures.</p>}
      {part?.movable && <p className="inspector-note">Drag this component in the viewport. Its rotor and protected volume move with it.</p>}
      {part?.movable && <PositionEditor part={part} onMove={onMovePart} />}
      {selectedConflicts.length > 0 && <section className="inspector-note" aria-label="Selection conflicts">
        <strong>{selectedConflicts.length} unresolved {selectedConflicts.length === 1 ? "conflict" : "conflicts"}</strong>
        {selectedConflicts.map(({ id, message }) => <p key={id}>{message ?? id}</p>)}
      </section>}

      {(details?.source || imported?.sourceUrl) && (
        <a className="source-link" href={details?.source ?? imported?.sourceUrl} target="_blank" rel="noreferrer">Open component source</a>
      )}

      <section className="constraint-control" aria-labelledby="constraint-title">
        <div><h3 id="constraint-title">Cable route</h3><p>Keep the wiring corridor outside every generated arm.</p></div>
        <button type="button" disabled={context.locks.includes("cable-clearance")} onClick={onLockCableClearance}>
          {context.locks.includes("cable-clearance") ? "Route protected" : "Protect route"}
        </button>
      </section>

      <details className="technical-details">
        <summary>Engineering details</summary>
        <dl className="property-list">
          <div><dt>Space</dt><dd>{context.coordinateSpace} · {context.unit}</dd></div>
          <div><dt>Preserved</dt><dd>{context.interfaces.preservedMounts} mounts · {context.interfaces.keepOuts} keep-outs</dd></div>
          {imported && <div><dt>Validation</dt><dd>{imported.validation.replaceAll("-", " ")}</dd></div>}
        </dl>
      </details>
    </aside>
  );
}
import { useEffect, useState } from "react";
