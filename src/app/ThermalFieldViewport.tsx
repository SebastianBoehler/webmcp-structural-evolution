import { useEffect, useMemo, useRef, useState } from "react";

import type { ThermalBrowserGateSession } from "../solver/thermal/browser-thermal-gate";
import { mountFieldRenderer, type FieldRendererSession } from "../viewer/field-renderer";
import { viewerEnvironment } from "../viewer/field-renderer-environment";

type Layer = "temperature" | "heat-flux";

export function ThermalFieldViewport({ session }: { readonly session: ThermalBrowserGateSession }) {
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<FieldRendererSession | undefined>(undefined);
  const [layer, setLayer] = useState<Layer>("temperature");
  const model = useMemo(() => {
    const request = session.benchmark?.request, result = session.output?.result;
    if (!request || !result) return undefined;
    const active = request.input.voxelPayload.activeCells;
    const indices: number[] = [];
    active.forEach((value, index) => { if (value) indices.push(index); });
    const currentInstances = new Uint32Array(indices);
    const grid = { dimensions: { width: result.grid.cellDimensions[0],
      height: result.grid.cellDimensions[1], depth: result.grid.cellDimensions[2] },
      cellSize: [result.grid.cellSizeM, result.grid.cellSizeM, result.grid.cellSizeM] as const,
      anchor: { position: result.grid.originM, orientation: [0, 0, 0, 1] as const } };
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
      alternativeLayers: [], analysisField: { kind: layer, values, maximum } };
  }, [layer, session]);
  useEffect(() => {
    if (!canvas.current || !model) return;
    const mounted = mountFieldRenderer(canvas.current, model, viewerEnvironment(undefined), {},
      { preserveDrawingBuffer: true });
    renderer.current = mounted;
    return () => { mounted.dispose(); if (renderer.current === mounted) renderer.current = undefined; };
  }, [model]);
  if (!model) return null;
  return <section className="thermal-gate__viewer" aria-label="Cobot temperature and heat-flux viewport">
    <canvas ref={canvas} role="img" aria-label={`Verified cobot ${layer} field`} />
    <div className="thermal-gate__layer" role="group" aria-label="Thermal field layer">
      <button type="button" aria-pressed={layer === "temperature"}
        onClick={() => setLayer("temperature")}>Temperature field</button>
      <button type="button" aria-pressed={layer === "heat-flux"}
        onClick={() => setLayer("heat-flux")}>Heat-flux field</button>
    </div>
  </section>;
}
