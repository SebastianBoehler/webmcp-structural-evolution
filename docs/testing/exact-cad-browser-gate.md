# Exact CAD browser gate

Date: 2026-08-30  
Verdict: **passed**

## Target and runtime

- Browser surface: Browser-plugin connected/default Chrome extension. The in-app surface reported unavailable for this rerun.
- URL: `http://127.0.0.1:5173/?exact-cad-gate=1`
- Server: `mise exec node@24.19.0 -- pnpm dev --host 127.0.0.1`
- Page capability: WebGPU `available`.
- OCCT execution: the Vite-served module worker initialized `occt-wasm@4.3.2` from the same application origin and completed all exact rebuilds. The gate page withholds all legacy fixture geometry until this succeeds.
- Visible render: one canvas rendered the exact 100 × 40 × 20 mm plate/boss/cut result. The isometric view visibly contained the rectangular plate, cylindrical revolved boss, and axial through-cut; no legacy drone/cobot geometry was mounted.
- Console after the final complete run: 0 application-origin warnings/errors. One unrelated wallet-extension error was present in the connected Chrome profile.

## Measured final run

| Field | Measured result | Gate |
|---|---:|---:|
| Initial document revision | `e7fa5849e3df89c64b6a7c295446473e368d4472a30b0c9063ebd3c8059d52d0` | exact |
| Dimension document revision | `5cd15a7ef4a3efed9af6ed4441026e84d0f2da7c4ece96b35a2709d98ef41cd3` | changed |
| Initial BREP SHA-256 | `0c72d3608fe4b4b1fdec869b1b45dd96971f8f2eba26a3b9e4af87d4d02a6df0` | digest-bound |
| Dimension BREP SHA-256 | `5e5269d56f5044321499b1f0a9a95d9eeee5b5cddcb396643e0af4308f34e174` | differs from initial |
| Final BREP SHA-256 | `5e5269d56f5044321499b1f0a9a95d9eeee5b5cddcb396643e0af4308f34e174` | deterministic final rebuild |
| Initial STEP SHA-256 | `6610e33a109d2e6f22e923780092a9050bec283bc75e4348d2cc3af25b00f7b7` | digest-bound |
| Dimension STEP SHA-256 | `8bf0b55f60eb034c8869ae9c274153d6aecf5bd1ac219893dfd23c06acab4c47` | differs from initial |
| Maximum mass relative error | `2.7056603272190553e-15` | ≤ `1e-6` |
| Maximum volume relative error | `2.7056603272190553e-15` | ≤ `1e-6` |
| Invalid-solid count | `0` | `0` |
| Imported STEP envelope | `100 × 40 × 20 mm` | exact expected envelope |
| STEP envelope relative error | `0` | ≤ `1e-6` |
| Cancellation | `cancelled`; late success `false` | no later success |
| Invalidated artifacts | `3` | initial BREP, semantic mesh, STEP removed on edit |
| Stale artifacts | `0` | `0` |
| Active exact artifacts | `4` | edited outputs plus exact imported BREP |
| Initial rebuild | `372.785000 ms` | measured |
| Dimension rebuild | `164.305000 ms` | measured |
| STEP round-trip | `75.295000 ms` | measured |
| Cancellation settle | `37.285000 ms` | includes bounded terminal quiescence |
| Final rebuild | `145.285000 ms` | measured |
| Total gate | `806.680000 ms` | measured |

The STEP browser round-trip uses the serialized OCCT worker/adapter boundary. The worker exact-imports the exported bytes, rejects non-solids, measures mass and surface-precise bounds from the exact shape, returns a digest-bound BREP artifact dependent on the source STEP artifact, and the gate attaches it to the active `DesignSession`. The live asset inventory contained `exact-step-import.ts` and `step-exchange.ts`, with no `assembly/step-import`, `occt-import-js`, `FoundationJourney`, or demo-fixture asset loaded.

## Automated gate

```text
mise exec node@24.19.0 -- pnpm vitest run src/cad/kernel src/cad/runtime-contracts.test.ts src/cad/design-session.test.ts src/app/App.exact-cad-route.test.tsx src/app/App.test.tsx src/app/useProjectState.test.tsx src/app/FoundationJourney.test.tsx
```

Result: PASS — 14 files, 69 tests.

```text
mise exec node@24.19.0 -- pnpm build
git diff --check
```

Result: PASS. Vite emitted the dedicated OCCT worker and separately served `occt-wasm.wasm`. The repository's pre-existing browser-externalization warnings remain; no application-origin runtime console warning or error occurred.

The dev-server terminal also printed missing-source sourcemap notices from the published `occt-wasm` package. The only whole-profile browser-console issue was an unrelated wallet-extension injection error; the application origin was clean.

## Explicit failure state

The gate route starts in a visible `Loading the exact OCCT worker; legacy geometry is withheld.` state. A Wasm/worker error becomes a typed visible alert beginning `Exact CAD is unavailable`. `App` selects this route before lazy-loading the legacy journey, so demo fixture/workspace/topology initialization never runs. Deterministic tests cover missing outputs, invalid solids, mass/volume tolerance failure, STEP envelope tolerance failure, stale artifacts, and a success emitted 5 ms after cancellation resolves.
