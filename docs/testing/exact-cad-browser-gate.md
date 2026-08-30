# Exact CAD browser gate

Date: 2026-08-31
Verdict: **passed**

## Target and runtime

- Browser surface: Codex in-app browser. No connected-Chrome fallback was needed.
- URL: `http://127.0.0.1:5173/?exact-cad-gate=1`
- Server: `mise exec node@24.19.0 -- pnpm dev --host 127.0.0.1`
- Page capability: WebGPU `available`.
- OCCT execution: the Vite-served module worker initialized `occt-wasm@4.3.2` from the same application origin and completed all exact rebuilds. The gate page withholds all legacy fixture geometry until this succeeds.
- Visible render: one `1280 × 288` CSS-pixel canvas (`2560 × 576` backing buffer) rendered the exact 100 × 40 × 20 mm result. The isometric capture visibly contained the rectangular plate, cylindrical revolved boss, and axial through-cut; no legacy drone/cobot geometry was mounted. The rerun exposed and fixed the route's previously collapsed viewport row before this evidence was accepted.
- Console after the final complete run: 0 application-origin warnings/errors.

## Measured final run

| Field | Measured result | Gate |
|---|---:|---:|
| Initial document revision | `1273ebd5e3e0099391f3e310555240ecc6f3d4bcc6586c0131642c62bcda33fa` | exact |
| Dimension document revision | `2225a06e7a470c4a4f8bf8b8e9eab8de9173d3c1960b647229dee899684739c8` | changed |
| Initial BREP SHA-256 | `dfa0349379831cde1728b3e2cdc3bee7891688bf5fdb4da5b83295f00ad2fb78` | digest-bound |
| Dimension BREP SHA-256 | `2d0a5fdae94d37fa28537020f0c8225357dde8442b902f6ffed89784d4e01e4d` | differs from initial |
| Final BREP SHA-256 | `2d0a5fdae94d37fa28537020f0c8225357dde8442b902f6ffed89784d4e01e4d` | deterministic final rebuild |
| Initial STEP SHA-256 | `1eb4ed12ef5ecf76e75b44192499242dcdc9b38edc387fe28788f4cb68ac68e0` | digest-bound |
| Dimension STEP SHA-256 | `d98e0d76173ab3d6987afbfecaf6d512c59c3d28be9fbf117a4f629c15d53838` | differs from initial |
| Maximum mass relative error | `2.7056603272190553e-15` | ≤ `1e-6` |
| Maximum volume relative error | `2.7056603272190553e-15` | ≤ `1e-6` |
| Invalid-solid count | `0` | `0` |
| Imported STEP envelope | `100 × 40 × 20 mm` | exact expected envelope |
| STEP envelope relative error | `0` | ≤ `1e-6` |
| Cancellation | `cancelled`; worker `quarantined`; late success `false` | old worker detached and terminated |
| Invalidated artifacts | `3` | initial BREP, semantic mesh, STEP removed on edit |
| Stale artifacts | `0` | `0` |
| Active exact artifacts | `4` | edited outputs plus exact imported BREP |
| Initial rebuild | `182.53000009059906 ms` | measured |
| Dimension rebuild | `32.81500005722046 ms` | measured |
| STEP round-trip | `49.419999957084656 ms` | measured |
| Cancellation settle | `29 ms` | terminate/quarantine plus bounded observation |
| Final rebuild | `186.68500006198883 ms` | fresh worker initialization and rebuild |
| Total gate | `487.60000002384186 ms` | measured |

The STEP browser round-trip uses the serialized OCCT worker/adapter boundary. The worker exact-imports the exported bytes, rejects non-solids, measures mass and surface-precise bounds from the exact shape, returns a digest-bound BREP artifact dependent on the source STEP artifact, and the gate attaches it to the active `DesignSession`. The live asset inventory contained `exact-step-import.ts` and `step-exchange.ts`, with no `assembly/step-import`, `occt-import-js`, `FoundationJourney`, or demo-fixture asset loaded.

## Automated gate

```text
mise exec node@24.19.0 -- pnpm vitest run src/cad/document-schema.test.ts src/cad/model-schema.test.ts src/cad/transactions.test.ts src/cad/design-session.test.ts src/cad/rebuild-payload.test.ts src/cad/runtime-contracts.test.ts src/cad/public-api.test.ts src/cad/kernel/feature-rebuild.test.ts src/cad/kernel/named-selection-resolution.test.ts src/cad/kernel/rebuild-results.test.ts src/cad/kernel/occt-adapter.test.ts src/cad/kernel/occt-worker-client.test.ts src/cad/kernel/occt-worker.test.ts src/cad/kernel/semantic-tessellation.test.ts src/cad/kernel/step-exchange.test.ts src/cad/kernel/browser-cad-gate.test.ts
```

Result: PASS — 16 files, 100 tests.

```text
mise exec node@24.19.0 -- pnpm check
git diff --check
```

Result: PASS — Wasm build; 85 Vitest files / 431 tests; TypeScript and Vite production build; 13 Rust unit tests; 5 Rust integration tests; 0 doc tests. Vite emitted the dedicated OCCT worker and separately served `occt-wasm.wasm`. The repository's pre-existing browser-externalization warnings remain; no application-origin runtime console warning or error occurred.

The dev-server terminal printed missing-source sourcemap notices from the published `occt-wasm` package. They did not appear in browser logs; the application origin was clean.

## Explicit failure state

The gate route starts in a visible `Loading the exact OCCT worker; legacy geometry is withheld.` state. A Wasm/worker error becomes a typed visible alert beginning `Exact CAD is unavailable`. `App` selects this route before lazy-loading the legacy journey, so demo fixture/workspace/topology initialization never runs. Cancellation detaches listeners and terminates the owning worker before publishing the terminal event; the next request uses a new worker. Deterministic tests cover a 60-second-delayed success attempt from the terminated worker, fresh-worker follow-up success, normal success/failure reuse, missing outputs, invalid solids, mass/volume tolerance failure, STEP envelope tolerance failure, and stale artifacts.
