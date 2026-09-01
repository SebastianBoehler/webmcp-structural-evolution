# Steady-thermal live browser gate

Open the isolated local route:

```text
http://127.0.0.1:5187/?thermal-gate=1
```

The route rebuilds the exact OCCT SE-6 upper-arm link, compiles its revision-owned thermal study, probes in-flight cancellation, then recovers through the production job runner and artifact store. The public solver path is WebGPU-only. Independent Wasm evaluation is private verification evidence and never supplies a result field or fallback.

## Locked case and checks

- Exact aluminum-6061 link: `0.42 × 0.08 × 0.08 m`, with the rectangle width and height constrained before the `0.08 m` extrusion.
- Grid: `42 × 8 × 8`, `0.01 m` cells, `2,688` active cells.
- Mounting interface: fixed at `300 K`; motor interface: `12,500 W/m²` over `0.0064 m²`, or `80 W`.
- Both boundary selections contain `64` represented faces. Selected and represented areas plus relative rasterization error are sealed in the report.
- The report must include the exact source revision and all three source artifact IDs: BREP, semantic mesh, and revision-bound thermal voxelization.
- WebGPU recurrence residual must be at most `1e-6`; GPU and independently evaluated energy imbalance must be at most `1e-3`.
- Independent Wasm temperature L2 must be at most `1e-3`; field and heat-rate deltas must be at most `2e-3`.
- Cancellation must occur after observed solver progress, emit one cancelled terminal, commit zero artifacts, and recover on a fresh job. The verified recovery commits exactly three artifacts atomically.
- The route and `run_cobot_thermal_study` WebMCP tool share the same service function. Automated parity tests require identical sealed report output.

## Measured live result — 2026-09-01

PASS in Chrome on Apple / Metal 3. The independently repeated in-app run also passed with zero isolated application warnings or errors. The final document-owned exact-BREP-voxelizer rerun sealed report digest is `8509609a7d7db20b2f167fcbf29810a19c9dd79e2d11e4cc8e5fefa71a9b14ae`.

- Source revision: `13cffc77c127d7ca56a443025a10db5c5e831a12cbd3d6a118d64ff9151c505d`.
- Source artifacts: document-owned BREP `7a617818…076f`, semantic mesh `d9e4e0ae…dfbb`, and exact-BREP-classified thermal voxelization `9a478b19…d70b`.
- Boundary evidence: each selected area was `0.0064 m²`; each represented area was `0.006400000000000004 m²`; relative error was `5.421010862427522e-16`.
- WebGPU solve: `170` iterations, recurrence residual `6.799128213808088e-9`, relative energy imbalance `1.244390112962969e-4`, and `300–330.6914978027344 K`.
- Independent Wasm verification: temperature L2 `6.30302002767887e-6`, field L2 `3.6252611934088034e-8`, heat-rate error `1.245117187760769e-4`, and independently evaluated energy imbalance `1.2449621751318732e-4`.
- Cancellation: one cancelled terminal, zero committed artifacts, and a successful recovery run.
- Persistence: temperature, heat-flux, and verified summary artifacts were atomically stored in the session-owned store and remained readable after the runner returned; artifact IDs begin `fc5164d4`, `9672ac61`, and `4f665244`.
- Measured final rerun timing: `1,445.44 ms` exact build plus exact-BREP classification, `1,143.99 ms` cancellation/recovery solve phase, and `2,725.91 ms` total.

The temperature and heat-flux layers were visibly rendered on desktop and in a native `390 × 844` viewport. The narrow view had a `390 px` document width, no horizontal overflow, single-column evidence, and usable field controls. Cancellation remained cancelled during a three-second quiescence check, and a manual restart passed.

The WebMCP tool registered in the in-app browser. That browser surface did not expose a programmatic tool-invocation method, so live invocation was not claimed; same-service registration, execution, digest parity, and error behavior are covered by route/WebMCP integration tests. No acceptance or promotion action is performed by this gate.
