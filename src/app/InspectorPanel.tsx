import type { FoundationContextSnapshot } from "../domain/foundation-context";
import { DRONE_ARM_FOUNDATION_STUDY } from "../samples/drone-arm-foundation";

const fixture = DRONE_ARM_FOUNDATION_STUDY;
const names: Readonly<Record<string, string>> = {
  "arm-design-region": "Arm design region",
  "motor-2207": "2207 brushless motor",
  "m3-fastener": "M3 × 12 fasteners",
  "body-interface": "Frame interface",
  "propeller-keep-out": "Propeller clearance",
  "cable-keep-out": "Cable clearance",
};

export interface InspectorPanelProps {
  readonly selectedId: string;
  readonly context: FoundationContextSnapshot;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onLockCableClearance: () => void;
}

export function InspectorPanel({
  selectedId,
  context,
  open,
  onClose,
  onLockCableClearance,
}: InspectorPanelProps) {
  const component = fixture.components.find((candidate) => candidate.id === selectedId);
  const inventory = component
    ? fixture.inventory.find((item) => item.componentRevision === component.revision)
    : undefined;
  const requirement = component
    ? fixture.assembly.components.find((item) => item.componentRevision === component.revision)
    : undefined;
  const locked = context.locks.includes("cable-clearance");
  const isRegion = selectedId === "arm-design-region";
  const isConstraint = selectedId.endsWith("keep-out");

  return (
    <aside className="side-panel inspector-panel" data-open={open} aria-label="Selection inspector">
      <div className="panel-heading">
        <div><h2>Inspector</h2><p>Selected geometry</p></div>
        <button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close inspector">×</button>
      </div>
      <div className="selection-heading">
        <span className="selection-icon" aria-hidden="true" />
        <div><h3>{names[selectedId] ?? selectedId}</h3><p>{component?.category ?? (isRegion ? "Design domain" : "Safety constraint")}</p></div>
      </div>

      {component && (
        <dl className="property-list">
          <div><dt>Part</dt><dd>{component.partNumber}</dd></div>
          <div><dt>Mass</dt><dd>{component.mass.value} {component.mass.unit}</dd></div>
          <div><dt>Inventory</dt><dd>{inventory?.ownedQuantity ?? 0} owned · {requirement?.quantity ?? 0} required</dd></div>
          <div><dt>Interfaces</dt><dd>{component.mountInterfaces.length} mounts · {component.keepOutVolumes.length} keep-out</dd></div>
        </dl>
      )}
      {isRegion && (
        <dl className="property-list">
          <div><dt>Resolution</dt><dd>{Object.values(context.grid.dimensions).join(" × ")} voxels</dd></div>
          <div><dt>Material</dt><dd>PLA foundation profile</dd></div>
          <div><dt>Process</dt><dd>Fused-filament fabrication</dd></div>
          <div><dt>Objective</dt><dd>Minimize compliance · 35% volume</dd></div>
        </dl>
      )}
      {isConstraint && (
        <p className="inspector-note">This protected volume stays outside every generated alternative.</p>
      )}

      <section className="constraint-control" aria-labelledby="constraint-title">
        <div><h3 id="constraint-title">Cable clearance</h3><p>Preserve the wiring route before generating another branch.</p></div>
        <button type="button" disabled={locked} onClick={onLockCableClearance}>
          {locked ? "Clearance locked" : "Lock clearance"}
        </button>
      </section>

      <details className="technical-details">
        <summary>Technical details</summary>
        <dl className="property-list">
          <div><dt>Coordinate space</dt><dd>{context.coordinateSpace} · {context.unit}</dd></div>
          <div><dt>Region bounds</dt><dd>{context.selection.min.join(", ")} → {context.selection.maxExclusive.join(", ")}</dd></div>
          <div><dt>Preserved geometry</dt><dd>{context.interfaces.preservedMounts} mounts · {context.interfaces.keepOuts} keep-outs</dd></div>
          <div><dt>Study revision</dt><dd><code>{fixture.study.revision}</code></dd></div>
          {component && <div><dt>Component revision</dt><dd><code>{component.revision}</code></dd></div>}
        </dl>
      </details>
    </aside>
  );
}
