export const MAX_RENDER_DPR = 2;

export function normalizeRenderDpr(rawDpr: number): number {
  const actualDpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1;
  return Math.min(MAX_RENDER_DPR, Math.max(1, actualDpr));
}
