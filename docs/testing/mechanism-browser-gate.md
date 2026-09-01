# SE-6 mechanism browser gate

## Run

On 2026-09-01, start the production Vite application and open the isolated route:

```bash
pnpm dev --host 127.0.0.1
```

`http://127.0.0.1:5173/?mechanism-gate=1`

The route is selected before WebGPU detection and before the legacy workbench. It uses exact OCCT workers for source construction and initial-overlap checks, then the pinned deterministic Rapier/Wasm worker for dynamics. The Three.js viewport is WebGL; this gate does not claim WebGPU mechanism physics or rendering.

## Prior measured baseline

The 2026-09-01 in-app browser run produced sealed session `193e8a4617382546f9ef22cd0a4c7078027e6ba11706c9b2008752d7cae86c8d`. That session predates the corrected cancellation and console-evidence schema, so it is retained only as a numeric baseline and is not a current gate pass. A fresh browser run is required before publishing a new current session ID.

- Exact assembly: 7 runtime bodies, fixed `base`, 6 revolute joints, and complete ownership of 52 visible cobot parts.
- Replay: 61 complete frames at 60 Hz over 240 fixed 240 Hz steps.
- Maximum joint deltas from the authored pose: `0.015718`, `0.083255`, `0.399532`, `-0.336314`, `0.601098`, and `-0.451985 rad`; all six axes moved and all limits were respected.
- Maximum joint-anchor error: `6.473023e-6 m` against the `1e-5 m` gate.
- Collision filtering: adjacent stages disabled, every nonadjacent stage enabled.
- Maximum penetration: `0 m` against the `1e-4 m` gate.
- Minimum requested clearance: `0.054343291 m`; all 39 expanded pairs were sampled on all frames (`2379` finite samples).
- Cancellation: the probe was cancelled in flight with one terminal, zero committed artifacts, no late terminal, and a successful fresh-worker restart.
- Timing: exact benchmark `319.12 ms`; cancellation plus recovery solve `1671.71 ms`; total `1991.68 ms`.
- Runner-owned console audit: 0 warnings and 0 errors during the solver/gate phase. It did not observe the subsequently mounted replay viewer.

The sealed report binds source revision `18386ffffa00cc9f41c6f0496aa061bc023857ced7777d899424f9cb00c65c32`, mechanism input `2ebd2d456a00a894ccd612d1ad9ebc974899b8b3b5a720cf4b499e83ad0860e9`, result `1765f20918bea2cc6b0550840084e0ef46feb9057047f15c45d52384c5f3cbd9`, replay `fd1fc52f63fb4e02ff332203e84888e9cf8a86034a1f00c77092848c0d4bdda6`, and replay artifact `72da2ebda83e25534a623e922612a6564eb53f2e45c88353db23f146b8f06420`.

An independent root-agent run in a new in-app tab reproduced those deterministic mechanism values in sealed session `ab34d89f74f19e8aa98a5621d5296459b5da9f27c7a7dfdaa35189f3a8c1effc`. Its measured timings were `273.47 ms` build, `1651.48 ms` cancellation plus recovery, and `1925.28 ms` total. The desktop and native `390 × 844` captures both showed the recognizable cobot and grid, the narrow layout remained readable, and a separate browser-UI console observation after first renderer mount and playback contained no warnings or errors. That UI observation is measured documentation, not evidence sealed into the runner report. Explicit UI cancellation remained cancelled for three seconds with no late success before a fresh rerun passed.

## Current corrected independent pass

After the worker-start, exact-registration, exact-geometry, and narrow-overlay corrections, an independent root-agent run in a brand-new in-app tab passed on 2026-09-01 at `2026-09-01T04:49:15.119Z`. Its sealed session is `ba536e247ae78d1c390930271074cc2d3d12f13b2ac9c34eb92e82d12e95e514`.

- Exact assembly: 7 runtime bodies, a fixed base, 6 revolute joints, and all 52 visible parts registered to the solved stage frames.
- Replay: 61 complete frames at 60 Hz. Joint deltas from the authored pose were `0.01608846`, `0.62120187`, `0.37084598`, `-0.32729324`, `0.46363126`, and `-0.37124811 rad`.
- Maximum joint-anchor error: `6.4206156e-6 m`; maximum penetration: `0 m`.
- Minimum requested clearance: `0.0146710388 m`; all 45 expanded pairs were sampled on all frames (`2745` finite samples).
- Cancellation: `workerStarted: true`, cancellation requested after worker start, zero probe artifacts committed, no late success for more than `3.2 s`, and a fresh rerun passed.
- Timing: exact benchmark `323.715 ms`; cancellation plus recovery solve `3620.765 ms`; total `3945.340 ms`.
- Sealed IDs: source revision `7cb51669863362c59b281023974958c94fce6ac32e7e9e0abc9228b8186ea0e6`, mechanism input `8418e22207cdb9eee626e38c48cd55897a44eb929c17412999b05f5bfdcf1138`, result `6a10eff76cabf29f1d8e4cd3c0c3a23ba1ca622bc7bb5339f2c7bed4ecf526f3`, replay `9954271f93b5262f6573f5ea562b8a036c31c3707ad18e522f33bb22993706ed`, and replay artifact `39283ba378f1e4be6fa49f7fa38f9096f7fe7e0003875b8723a7b780905c3c24`. The two exact-source artifacts were `3f05c158ad9130c38d65d5c77534d3beaa577dd6133c1b92feea1c8efa166d88` and `d620634a18e9cbdbb13be76efbe569a83d27d44881d7c413c38dd4d52e2d2311`.
- Desktop and native `390 × 844` screenshots showed the recognizable complete cobot and grid. At `390 × 844`, the full status, transform controls, and orientation controls occupied separate rows with zero pairwise DOM-rectangle intersections.
- Fresh desktop and narrow post-mount browser observations contained no warnings or errors. These are independent UI measurements, not fields in the sealed solver report.
- Pause froze the frame and clearance overlay together; restart returned to frame 1.

## Current acceptance semantics

- Cancellation is requested only after the typed production solver-worker `started` partial. A passed report must bind `workerStarted: true` and `cancellationRequestedAfterWorkerStart: true`.
- An outer route abort gates every build, probe, recovery, result-acceptance, and report-sealing transition. An abort after the cancelled probe terminal cannot launch or commit a recovery run.
- The runner audit is serialized as `solverPhaseConsole` because it ends before viewer mount. `browserUiConsole` is deliberately absent from the strict sealed-report schema; browser UI console evidence must be measured independently after first renderer mount and playback.

## Interactive checks

- `Cancel live run` aborts the active route owner. `Run gate again` starts a fresh exact build and worker job.
- `Pause replay` freezes both the displayed body poses and clearance/contact overlay. In the measured check, frame `2/61`, step `4`, and its `73.004 mm` overlay remained unchanged for 500 ms; `Resume replay` continued it.
- `Restart replay` returns to frame 1 and pauses, without rerunning physics.
- The report is explicitly audit-only with `authorizesEngineeringResult: false`; live replay authority remains the in-process `MechanismResult` and is not reconstructed from the serialized report.
