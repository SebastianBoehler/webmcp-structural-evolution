# Recording Readiness Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the actual component workspace recordable by rendering authored model assets in WebGPU, exposing lower-truth topology estimates honestly, and completing the original 35% SE-6 component topology study without redundant analyses.

**Architecture:** Keep one exact design document and the existing fail-closed solver contracts. Materialize authored GLB nodes into real triangle meshes before semantic WebGPU document construction, represent an interactive estimate as a successful-but-non-promotable result, and improve f32 structural stability with compensated displacement accumulation plus the smallest observed sufficient component-only iteration envelope. Stop the monotone topology loop as soon as its rounded binary material target is reached.

**Tech Stack:** TypeScript, React, Three.js/GLTFLoader, WebGPU/WGSL, Vitest, pnpm, Node 24.19.0.

**Spec:** `docs/superpowers/specs/2026-08-29-browser-native-cad-platform-design.md`; `docs/superpowers/specs/2026-08-29-detailed-six-axis-cobot-design.md`

## Global Constraints

- Preserve the existing 52-part SE-6 assembly and reference-drone component data.
- Materialize actual authored GLB triangles; never substitute bounding boxes, envelopes, procedural stand-ins, or saved geometry.
- Keep the generic semantic adapter fail-closed for any unmaterialized `kind: "model"` part.
- An `interactive-estimate` is completed lower-truth evidence, never verified, comparable, promotable, or accepted topology.
- Keep structural residual tolerance `1e-5`, refinement count, force/energy/reference gates, topology target `0.35`, and all acceptance/truth labels unchanged.
- The component-only PCG envelope may increase from `1_024` to exactly `2_048`; the default analytical budget stays unchanged.
- Do not add CPU, saved-result, generic-geometry, or fixture fallbacks to showcased routes.
- Stop topology only when the monotone binary mask has reached the rounded target count; do not infer convergence from a floating density delta.
- Keep production files below the 300 LOC soft limit; create focused modules instead of expanding already-large files.
- Use focused RED/GREEN tests per task, one production build/full check at the end, and one decisive live browser pass for the real component topology route.

---

### Task 1: Materialize authored model assets for semantic WebGPU

**Files:**
- Create: `src/viewer/semantic-model-materializer.ts`
- Create: `src/viewer/semantic-model-materializer.test.ts`
- Modify: `src/viewer/semantic-field-session.ts`
- Modify: `src/viewer/FieldViewer.semantic-session.test.tsx`
- Preserve: `src/viewer/semantic-scene-adapter.ts`
- Preserve: `src/viewer/semantic-primitive-fidelity.test.ts`

**Interfaces:**
- Consumes: `AssemblyVisualPart`, `CadMesh`, and GLTF scenes loaded by `GLTFLoader.loadAsync(assetUrl)`.
- Produces: `materializeSemanticModelParts(parts, loader?): Promise<readonly AssemblyVisualPart[]>`, returning each model part as a same-identity `kind: "mesh"` part whose surfaces contain flattened authored triangles in millimetres.

- [ ] **Step 1: Write failing materialization tests**

Build a nested Three.js scene with translated/rotated mesh nodes and indexed triangles. Assert that materialization preserves `id`, `selectionId`, center, rotation, appearance, and interaction metadata; bakes only asset-internal world transforms and `m -> mm` scaling into positions/normals; reports the real triangle count/size; and caches one load per URL. Assert empty/non-triangle scenes and loader failures reject with the asset/part identity. Keep the existing adapter test that rejects an unmaterialized model.

- [ ] **Step 2: Verify RED**

Run: `mise exec node@24.19.0 -- pnpm test:run src/viewer/semantic-model-materializer.test.ts src/viewer/semantic-primitive-fidelity.test.ts`

Expected: FAIL because `materializeSemanticModelParts` does not exist; the existing unmaterialized-model rejection remains PASS.

- [ ] **Step 3: Implement real triangle materialization**

Use a module-level URL-to-promise cache. Clone/traverse the loaded scene, call `updateMatrixWorld(true)`, clone each `THREE.Mesh` geometry, apply the mesh world matrix after the asset-unit scale, compute normals only when absent, and copy owned `Float32Array`/`Uint32Array` buffers into `CadSurface` records. Generate sequential indices only for a valid non-indexed triangle list. Reject empty, non-finite, inconsistent, or non-triangle geometry. Dispose only temporary cloned geometries; do not dispose the cached source scene.

- [ ] **Step 4: Await materialization at the semantic session boundary**

In `mountSemanticFieldSession`, materialize `model.assemblyParts` before every semantic artifact build, including `updateModel`. Keep capture lifecycle errors visible and dispose the viewport on initial failure. Do not change `artifactFromViewerModel` or its explicit model rejection.

- [ ] **Step 5: Verify GREEN and commit**

Run: `mise exec node@24.19.0 -- pnpm test:run src/viewer/semantic-model-materializer.test.ts src/viewer/FieldViewer.semantic-session.test.tsx src/viewer/semantic-primitive-fidelity.test.ts`

Expected: all tests PASS, including visible loader failure and unchanged unmaterialized-model rejection.

Commit: `fix(viewer): materialize authored models for WebGPU`

---

### Task 2: Make interactive estimates reviewable without elevating truth

**Files:**
- Modify: `src/webmcp/executors.ts`
- Modify: `src/webmcp/executors.test.ts`
- Modify: `src/app/optimization-navigation.ts`
- Create: `src/app/optimization-navigation.test.ts`
- Modify: `src/app/useProjectState.ts`
- Modify: `src/app/useProjectState.test.tsx`
- Modify: `src/app/ReceiptLedger.tsx`
- Modify: `src/app/ReceiptLedger.test.tsx`
- Modify: `src/app/FoundationJourney.test.tsx`

**Interfaces:**
- Consumes: a `FoundationBranch` with `status: "estimate"` and `result.truthLevel: "interactive-estimate"`.
- Produces: `OptimizationNavigation.pendingEstimate?: FoundationBranch`; WebMCP success response with `status: "estimate"`; succeeded receipt result containing `truthLevel: "interactive-estimate"`; primary action label `Review interactive estimate`.

- [ ] **Step 1: Write failing contract and navigation tests**

Assert `generate_topology_candidate` returns `isError !== true` for `estimate` while retaining its status/truth message and omitting comparison. Assert navigation selects the latest non-stale estimate only after no runnable next variant exists, labels it `Review interactive estimate`, and never exposes it as `pendingPromotion` or `readyToCompare`.

- [ ] **Step 2: Verify RED**

Run: `mise exec node@24.19.0 -- pnpm test:run src/webmcp/executors.test.ts src/app/optimization-navigation.test.ts`

Expected: FAIL because estimates are tool errors and navigation ends at `No action available`.

- [ ] **Step 3: Implement the lower-truth completion contract**

Treat only `failed`, `mismatch`, and `canceled` terminal branches as tool errors. Keep comparison/promotion predicates restricted to verified branches. Add `pendingEstimate` to navigation after runnable variants, comparison, and verified promotion are exhausted.

- [ ] **Step 4: Record and render an explicit estimate receipt**

Store an estimate as a succeeded action receipt whose result includes proposal/branch/attempt, measurement, `status: "estimate"`, and `truthLevel: "interactive-estimate"`. Render its badge as `Interactive estimate` with neutral tone and copy that says it is available for evidence review, not verified engineering output. Preserve failed/canceled receipt behavior.

- [ ] **Step 5: Connect the primary action to the existing Evidence/Branches drawer**

When `pendingEstimate` is selected, open the existing review drawer. Assert the estimate metrics appear, `Use this frame` remains disabled, comparison stays unavailable, and no accepted density/result layer is rendered.

- [ ] **Step 6: Verify GREEN and commit**

Run: `mise exec node@24.19.0 -- pnpm test:run src/webmcp/executors.test.ts src/app/optimization-navigation.test.ts src/app/useProjectState.test.tsx src/app/ReceiptLedger.test.tsx src/app/FoundationJourney.test.tsx`

Expected: all tests PASS with estimate reviewability and unchanged promotion/comparison fences.

Commit: `fix(workbench): expose interactive estimate review`

---

### Task 3: Stabilize long component PCG displacement accumulation

**Files:**
- Modify: `src/solver/structural/gpu-resources.ts`
- Modify: `src/solver/structural/gpu-pipelines.ts`
- Modify: `src/solver/structural/structural-gpu-commands.ts`
- Modify: `src/solver/structural/vector.wgsl`
- Modify: `src/solver/structural/structural-contract.ts`
- Modify: `src/solver/structural/webgpu-structural-adapter.test.ts`
- Modify: `src/solver/structural/structural-result-artifacts.test.ts`

**Interfaces:**
- Consumes: the existing f32 PCG recurrence and component planner settings.
- Produces: one DOF-sized `xCompensation` GPU storage buffer and Kahan-style solution accumulation; `COMPONENT_STRUCTURAL_PCG_ITERATION_BUDGET = 2_048` while the analytical/default budget remains unchanged.

- [ ] **Step 1: Write failing recording-device/resource tests**

Assert a structural PCG run allocates, binds, initializes, and destroys `structural-x-compensation`; the vector bind-group has binding `9`; initialization zeros it; and solution updates preserve the existing residual/preconditioner dispatch order. Update the component metadata expectation to exactly `2_048` while keeping the default budget expectation unchanged.

- [ ] **Step 2: Verify RED**

Run: `mise exec node@24.19.0 -- pnpm test:run src/solver/structural/webgpu-structural-adapter.test.ts src/solver/structural/structural-result-artifacts.test.ts`

Expected: FAIL because binding `9`, the compensation buffer, and the `2_048` component envelope do not exist.

- [ ] **Step 3: Add owned compensation resources**

Allocate a DOF-sized storage buffer labeled `structural-x-compensation`, include it in the owned resource list, bind it at vector binding `9`, and let the existing resource cleanup destroy it. Do not add a second compensation buffer for the recursive residual.

- [ ] **Step 4: Implement x-only compensated accumulation in WGSL**

Zero compensation beside `solution` in `initialize_pcg`. In `update_solution_residual`, replace `solution += alpha * direction` with:

```wgsl
let increment = params.alpha * direction[id.x];
let corrected = increment - solution_compensation[id.x];
let next = solution[id.x] + corrected;
solution_compensation[id.x] = (next - solution[id.x]) - corrected;
solution[id.x] = next;
```

Leave the residual update, block-Jacobi preconditioner, operator, tolerance, refinement/acceptance logic, and truth level unchanged.

- [ ] **Step 5: Raise only the component iteration envelope**

Set `COMPONENT_STRUCTURAL_PCG_ITERATION_BUDGET` to exactly `2_048`. Keep `STRUCTURAL_DEFAULT_PCG_ITERATION_BUDGET` unchanged. This bound covers the observed longest recursive-converged pass (`1_750`) without adopting the disproven `4_096` budget as the production default.

- [ ] **Step 6: Verify GREEN and commit**

Run: `mise exec node@24.19.0 -- pnpm test:run src/solver/structural/webgpu-structural-adapter.test.ts src/solver/structural/structural-result-artifacts.test.ts src/solver/structural/mixed-precision-refinement.test.ts`

Expected: all tests PASS; no assertion weakens numerical gates or treats a recursive residual alone as final engineering acceptance.

Commit: `fix(structural): compensate component PCG accumulation`

---

### Task 4: Stop the monotone topology loop at its material target

**Files:**
- Modify: `src/solver/topology/topology-adapter.ts`
- Modify: `src/solver/topology/topology-adapter.test.ts`
- Modify: `src/solver/topology/topology-domain.test.ts`

**Interfaces:**
- Consumes: `topologyDiscreteLimits(...).targetCount` and each analyzed binary mask.
- Produces: a topology history ending at the first analyzed mask whose active count equals the rounded target; extraction/post-analysis continue from that exact density/mask.

- [ ] **Step 1: Write a failing target-stop regression**

Use the existing recording adapters to configure more `maxIterations` than the discrete move schedule needs. Assert structural analysis occurs for baseline plus only the removal steps required to reach `targetCount`, objective samples and binary masks remain aligned, and post-extraction analysis still runs once. Add a domain assertion that projection at `targetCount` cannot swap/reactivate cells.

- [ ] **Step 2: Verify RED**

Run: `mise exec node@24.19.0 -- pnpm test:run src/solver/topology/topology-adapter.test.ts src/solver/topology/topology-domain.test.ts`

Expected: FAIL because the adapter analyzes every configured iteration after the monotone target is already reached.

- [ ] **Step 3: Terminate only on the discrete target**

Compute `targetCount` once from the validated design domain/passive sets. After each analyzed mask, break the loop when its active count equals `targetCount`. Do not stop on a floating density norm, unchanged objective, solver iteration count, or elapsed time. Keep extraction, rerasterization, post-analysis, and acceptance unchanged.

- [ ] **Step 4: Verify GREEN and commit**

Run: `mise exec node@24.19.0 -- pnpm test:run src/solver/topology/topology-adapter.test.ts src/solver/topology/topology-domain.test.ts src/reference/full-assembly.integration.test.ts`

Expected: all tests PASS; the exact component reference integration remains intact.

Commit: `fix(topology): stop at the discrete material target`

---

## Final Verification (controller-owned)

- Run focused combined tests for the four tasks.
- Run once: `mise exec node@24.19.0 -- pnpm check`.
- Start the production Vite app from this worktree and verify in the real in-app browser:
  - reference drone loads authored motor/propeller GLB triangles in the semantic WebGPU viewport with no alert;
  - ordinary SE-6 `generate_topology_candidate` returns a reviewable interactive estimate and cannot promote/compare/render it as accepted topology;
  - `?structural-topology-gate=1` completes the original 35% SE-6 component topology route on real WebGPU, reaches the rounded material target, runs post-extraction structural verification, and reports no console errors;
  - mechanism and thermal routes receive one narrow smoke check because they were already green at the same base commit.
- If the original 35% live gate still fails, keep Tasks 1, 2, and 4, revert/adjudicate only Task 3, and record the exact remaining numerical blocker. Do not change the topology target or any engineering tolerance to force a pass.
