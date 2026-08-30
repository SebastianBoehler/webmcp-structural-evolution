import type { GpuCapability } from "../gpu/capabilities";
import type { FoundationProjectState } from "../webmcp/schemas";
import { FieldViewer, type FieldViewerEnvironment } from "../viewer/FieldViewer";
import type { ExactCadProjectGateState } from "./use-exact-cad-project-gate";

interface ExactCadGateViewProps {
  readonly gate: Exclude<ExactCadProjectGateState, { status: "inactive" }>;
  readonly capability: GpuCapability;
  readonly context: FoundationProjectState["context"];
  readonly viewerEnvironment?: FieldViewerEnvironment;
}

export function ExactCadGateView({ gate, capability, context, viewerEnvironment }: ExactCadGateViewProps) {
  if (gate.status === "running") return (
    <main className="workbench-shell" aria-label="Exact CAD browser gate">
      <p className="global-error" role="status">Loading the exact OCCT worker; legacy geometry is withheld.</p>
    </main>
  );
  if (gate.status === "failed") return (
    <main className="workbench-shell" aria-label="Exact CAD browser gate">
      <p className="global-error" role="alert">
        Exact CAD is unavailable: {gate.message}. No legacy geometry was loaded.
      </p>
    </main>
  );
  const result = gate.result;
  const part = [{
    id: "exact-browser-part", selectionId: "exact-browser-part", label: "Exact OCCT plate, boss, and cut",
    appearance: "generated" as const, kind: "mesh" as const, center: [0, 0, 0] as const,
    material: "structural" as const, mesh: result.renderMesh,
  }];
  return (
    <main className="workbench-shell" aria-label="Exact CAD browser gate">
      <section className="viewport-workspace" aria-labelledby="exact-cad-gate-title">
        <h1 id="exact-cad-gate-title">Exact CAD browser gate passed</h1>
        <div className="viewport-canvas"><div className="viewport-scene">
          <FieldViewer
            current={null} alternatives={[]} selectedRegion={context.selection}
            threshold={0.5} mode="overlay" grid={context.grid} assemblyParts={part}
            selectedPart="exact-browser-part" environment={viewerEnvironment}
            statusText="Exact OCCT plate, revolved boss, and through-cut · dimension rebuilt · cancellation observed · STEP round-trip passed"
          />
        </div></div>
        <dl aria-label="Exact CAD measured gate fields">
          <div><dt>WebGPU</dt><dd>{capability.status}</dd></div>
          <div><dt>Initial BREP SHA-256</dt><dd>{result.hashes.initialBrep}</dd></div>
          <div><dt>Dimension BREP SHA-256</dt><dd>{result.hashes.dimensionBrep}</dd></div>
          <div><dt>Final BREP SHA-256</dt><dd>{result.hashes.finalBrep}</dd></div>
          <div><dt>Initial STEP SHA-256</dt><dd>{result.hashes.initialStep}</dd></div>
          <div><dt>Dimension STEP SHA-256</dt><dd>{result.hashes.dimensionStep}</dd></div>
          <div><dt>Initial revision</dt><dd>{result.revisions.initial}</dd></div>
          <div><dt>Dimension revision</dt><dd>{result.revisions.dimension}</dd></div>
          <div><dt>Mass relative error</dt><dd>{result.measurements.maximumMassRelativeError}</dd></div>
          <div><dt>Volume relative error</dt><dd>{result.measurements.maximumVolumeRelativeError}</dd></div>
          <div><dt>Invalid solids</dt><dd>{result.measurements.invalidSolidCount}</dd></div>
          <div><dt>STEP envelope relative error</dt><dd>{result.stepRoundTrip.envelopeRelativeError}</dd></div>
          <div><dt>Imported STEP envelope</dt><dd>{result.stepRoundTrip.importedEnvelopeMm.join(" × ")} mm</dd></div>
          <div><dt>Cancellation</dt><dd>{result.cancellation.outcome}; late success {String(result.cancellation.lateSuccess)}</dd></div>
          <div><dt>Stale artifacts</dt><dd>{result.artifacts.staleCount}</dd></div>
          <div><dt>Invalidated artifacts</dt><dd>{result.artifacts.invalidatedCount}</dd></div>
          <div><dt>Initial rebuild</dt><dd>{result.timingsMs.initialRebuild} ms</dd></div>
          <div><dt>Dimension rebuild</dt><dd>{result.timingsMs.dimensionRebuild} ms</dd></div>
          <div><dt>STEP round-trip</dt><dd>{result.timingsMs.stepRoundTrip} ms</dd></div>
          <div><dt>Cancellation settle</dt><dd>{result.timingsMs.cancellation} ms</dd></div>
          <div><dt>Final rebuild</dt><dd>{result.timingsMs.finalRebuild} ms</dd></div>
          <div><dt>Total gate</dt><dd>{result.timingsMs.total} ms</dd></div>
        </dl>
      </section>
    </main>
  );
}
