export interface FieldDomain { readonly dimensions: readonly [number, number, number]; readonly cellSize: readonly [number, number, number]; readonly origin: readonly [number, number, number]; readonly active: Uint8Array }
export interface FieldValues { readonly density?: Float32Array; readonly scalar?: Float32Array; readonly displacement?: Float32Array; readonly flux?: Float32Array }
export interface FieldSample { readonly center: readonly [number, number, number]; readonly visible: boolean; readonly density: number; readonly scalar?: number; readonly displacement?: readonly [number, number, number]; readonly flux?: readonly [number, number, number] }
export type SpatialVectorKind = "none" | "displacement" | "flux" | "displacement-and-flux";
export interface SpatialRenderInput extends FieldDomain { readonly values: Float32Array;
  readonly maximum: number; readonly vectorKind: SpatialVectorKind;
  readonly displacement?: Float32Array; readonly flux?: Float32Array }
export interface SpatialRenderSample { readonly center: readonly [number, number, number]; readonly colorValue: number; readonly fluxTo?: readonly [number, number, number] }

function vector(values: Float32Array | undefined, cell: number): readonly [number, number, number] | undefined {
  return values ? [values[cell * 3]!, values[cell * 3 + 1]!, values[cell * 3 + 2]!] : undefined;
}

export function fieldSamples(domain: FieldDomain, values: FieldValues): readonly FieldSample[] {
  const [width, height, depth] = domain.dimensions, samples: FieldSample[] = [];
  const count = width * height * depth;
  if (domain.active.length !== count) throw new Error("Field occupancy does not match grid dimensions.");
  for (let cell = 0; cell < count; cell += 1) {
    const x = cell % width, y = Math.floor(cell / width) % height, z = Math.floor(cell / (width * height));
    samples.push({ center: [domain.origin[0] + (x + .5) * domain.cellSize[0], domain.origin[1] + (y + .5) * domain.cellSize[1], domain.origin[2] + (z + .5) * domain.cellSize[2]], visible: domain.active[cell] !== 0, density: values.density?.[cell] ?? 1, ...(values.scalar ? { scalar: values.scalar[cell]! } : {}), ...(values.displacement ? { displacement: vector(values.displacement, cell) } : {}), ...(values.flux ? { flux: vector(values.flux, cell) } : {}) });
  }
  return samples;
}

export function spatialRenderSamples(input: SpatialRenderInput): readonly SpatialRenderSample[] {
  if ((input.vectorKind === "displacement" || input.vectorKind === "displacement-and-flux")
    && !input.displacement) throw new Error("Signed displacement vectors are required for displacement rendering.");
  if ((input.vectorKind === "flux" || input.vectorKind === "displacement-and-flux")
    && !input.flux) throw new Error("Signed flux vectors are required for flux rendering.");
  const scale = Math.min(...input.cellSize) * .7;
  return fieldSamples(input, { scalar: input.values, displacement: input.displacement, flux: input.flux }).flatMap((sample) => {
    if (!sample.visible) return [];
    const center: [number, number, number] = sample.displacement
      ? [sample.center[0] + sample.displacement[0], sample.center[1] + sample.displacement[1],
        sample.center[2] + sample.displacement[2]]
      : [...sample.center];
    const flux = sample.flux, magnitude = flux ? Math.hypot(...flux) : 0;
    const fluxTo: [number, number, number] | undefined = flux && magnitude > 0
      ? [center[0] + flux[0] / magnitude * scale, center[1] + flux[1] / magnitude * scale, center[2] + flux[2] / magnitude * scale] : undefined;
    return [{ center, colorValue: Math.max(0, Math.min(1, (sample.scalar ?? 0) / Math.max(input.maximum, Number.EPSILON))), ...(fluxTo ? { fluxTo } : {}) }];
  });
}
