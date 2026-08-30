# Exact CAD browser gate

Date: 2026-08-30  
Verdict: **passed**

## Target and runtime

- Browser surface: Codex In-app Browser (selected by the mandated Browser control runtime for the target URL).
- URL: `http://127.0.0.1:5173/?exact-cad-gate=1`
- Server: `mise exec node@24.19.0 -- pnpm dev --host 127.0.0.1`
- Page capability: WebGPU `available`.
- OCCT execution: the Vite-served module worker initialized `occt-wasm@4.3.2` from the same application origin and completed all exact rebuilds. The gate page withholds all legacy fixture geometry until this succeeds.
- Visible render: one canvas rendered the exact 100 × 40 × 20 mm plate/boss/cut result. The isometric view visibly contained the rectangular plate, cylindrical revolved boss, and axial through-cut; no legacy drone/cobot geometry was mounted.
- Console after the final complete run: 0 warnings, 0 errors.

## Measured final run

| Field | Measured result | Gate |
|---|---:|---:|
| Initial document revision | `e7fa5849e3df89c64b6a7c295446473e368d4472a30b0c9063ebd3c8059d52d0` | exact |
| Dimension document revision | `5cd15a7ef4a3efed9af6ed4441026e84d0f2da7c4ece96b35a2709d98ef41cd3` | changed |
| Initial BREP SHA-256 | `0c72d3608fe4b4b1fdec869b1b45dd96971f8f2eba26a3b9e4af87d4d02a6df0` | digest-bound |
| Dimension BREP SHA-256 | `5e5269d56f5044321499b1f0a9a95d9eeee5b5cddcb396643e0af4308f34e174` | differs from initial |
| Final BREP SHA-256 | `5e5269d56f5044321499b1f0a9a95d9eeee5b5cddcb396643e0af4308f34e174` | deterministic final rebuild |
| Initial STEP SHA-256 | `6d6e897a80124c1d4201d399aefbde4c9ba4413accadf44fa03b5c24a318a0cd` | digest-bound |
| Dimension STEP SHA-256 | `c35e8e2cba83da5ef5e0502c9f9626f4e083d2780b4a944f5a024dd16f080935` | differs from initial |
| Maximum mass relative error | `1.9598110853631102e-16` | ≤ `1e-6` |
| Maximum volume relative error | `1.9598110853631102e-16` | ≤ `1e-6` |
| Invalid-solid count | `0` | `0` |
| Imported STEP envelope | `100 × 40 × 20 mm` | exact expected envelope |
| STEP envelope relative error | `0` | ≤ `1e-6` |
| Cancellation | `cancelled`; late success `false` | no later success |
| Invalidated artifacts | `3` | initial BREP, semantic mesh, STEP removed on edit |
| Stale artifacts | `0` | `0` |
| Initial rebuild | `188.750000 ms` | measured |
| Dimension rebuild | `30.950000 ms` | measured |
| STEP round-trip | `96.155000 ms` | measured |
| Cancellation settle | `1.175000 ms` | measured |
| Final rebuild | `29.830000 ms` | measured |
| Total gate | `351.820000 ms` | measured |

The STEP browser round-trip uses the repository's existing bounded OCCT STEP tessellation importer to measure the exported envelope. Exact imported-solid validation and handle cleanup are additionally covered by `step-exchange.test.ts`; the live claim is the measured browser envelope, not direct inspection of worker-owned OCCT handles.

## Automated gate

```text
mise exec node@24.19.0 -- pnpm vitest run src/cad/kernel src/app/useProjectState.test.tsx
```

Result: PASS — 9 files, 42 tests.

```text
mise exec node@24.19.0 -- pnpm build
git diff --check
```

Result: PASS. Vite emitted the dedicated OCCT worker and separately served `occt-wasm.wasm`. The repository's pre-existing browser-externalization and large-chunk warnings remain; no runtime console warning or error occurred.

The dev-server terminal also printed missing-source sourcemap notices from the published `occt-wasm` package. These were server-side dependency metadata notices; the inspected browser console remained empty.

## Explicit failure state

The gate route starts in a visible `Loading the exact OCCT worker; legacy geometry is withheld.` state. A Wasm/worker error becomes a typed visible alert beginning `Exact CAD is unavailable`, and the fixture renderer is never mounted on that branch. Deterministic tests cover missing outputs, invalid solids, mass/volume tolerance failure, STEP envelope tolerance failure, stale artifacts, and success after cancellation.
