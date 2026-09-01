import { useMemo, useRef, useState, type RefObject } from "react";

import type { ThermalBrowserGateSession } from "../solver/thermal/browser-thermal-gate";
import type { ViewerRenderModel } from "../viewer/render-model-types";
import { useThermalViewportLifecycle } from "./use-thermal-viewport-lifecycle";

type Layer = "temperature" | "heat-flux";

export function ThermalFieldViewport({ session }: { readonly session: ThermalBrowserGateSession }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layer, setLayer] = useState<Layer>("temperature");
  const model = useMemo(() => {
    const request = session.benchmark?.request, result = session.output?.result;
    if (!request || !result) return undefined;
    const active = request.input.voxelPayload.activeCells;
    const indices: number[] = [];
    active.forEach((value, index) => { if (value) indices.push(index); });
    const currentInstances = new Uint32Array(indices);
    const millimetres = (metres: number) => metres * 1_000;
    const grid = { dimensions: { width: result.grid.cellDimensions[0],
      height: result.grid.cellDimensions[1], depth: result.grid.cellDimensions[2] },
      cellSize: [millimetres(result.grid.cellSizeM), millimetres(result.grid.cellSizeM),
        millimetres(result.grid.cellSizeM)] as const,
      anchor: { position: [millimetres(result.grid.originM[0]), millimetres(result.grid.originM[1]),
        millimetres(result.grid.originM[2])] as const,
        orientation: [0, 0, 0, 1] as const } };
    let values: Float32Array, maximum: number;
    if (layer === "temperature") {
      const minimum = Math.min(...result.temperatureK), range = Math.max(1e-6,
        Math.max(...result.temperatureK) - minimum);
      values = Float32Array.from(result.temperatureK, (value) => (value - minimum) / range);
      maximum = 1;
    } else {
      values = Float32Array.from({ length: active.length }, (_value, cell) => Math.hypot(
        result.heatFluxWm2[cell * 3]!, result.heatFluxWm2[cell * 3 + 1]!,
        result.heatFluxWm2[cell * 3 + 2]!,
      ));
      maximum = Math.max(...values, 1e-6);
    }
    return { grid, currentInstances, densityField: Float32Array.from(active),
      alternativeLayers: [], analysisField: { kind: layer, values, maximum,
        ...(layer === "heat-flux" ? { vectors: result.heatFluxWm2,
          vectorUnit: "W/m^2" as const } : {}) } };
  }, [layer, session]);
  if (!model) return null;
  return <ThermalFieldViewportReady canvas={canvas} layer={layer} model={model}
    session={session} setLayer={setLayer}/>;
}

function ThermalFieldViewportReady({ canvas, layer, model, session, setLayer }: {
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  readonly layer: Layer;
  readonly model: ViewerRenderModel;
  readonly session: ThermalBrowserGateSession;
  readonly setLayer: (layer: Layer) => void;
}) {
  const lifecycle = useThermalViewportLifecycle(canvas, model,
    session.report.status === "passed" ? session.report.sourceRevision : "blocked", layer, session);
  const exact = lifecycle.state.layer === layer ? lifecycle.state.kind : "initializing";
  const label = `${exact === "ready" ? "Verified" : exact === "error" ? "Failed" : "Initializing"} cobot ${layer} field`;
  return <section className="thermal-gate__viewer" aria-label="Cobot temperature and heat-flux viewport">
    <canvas ref={canvas} role="img" aria-label={label} />
    {exact === "error" && lifecycle.state.kind === "error"
      ? <p role="alert">Thermal viewport failed: {lifecycle.state.message} <button type="button"
        onClick={lifecycle.retry}>Retry viewport</button></p>
      : <p role="status">{exact === "ready" ? `${layer} viewport ready after verified capture.`
        : `${layer} viewport initializing; verification is pending.`}</p>}
    <div className="thermal-gate__layer" role="group" aria-label="Thermal field layer">
      <button type="button" aria-pressed={layer === "temperature"}
        onClick={() => setLayer("temperature")}>Temperature field</button>
      <button type="button" aria-pressed={layer === "heat-flux"}
        onClick={() => setLayer("heat-flux")}>Heat-flux field</button>
    </div>
  </section>;
}
