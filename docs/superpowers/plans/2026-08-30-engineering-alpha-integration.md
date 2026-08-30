# Engineering Alpha Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate exact CAD, structural/topology, mechanism, and thermal capabilities into one hybrid human/agent workbench and prove the September 4 acceptance journey live.

**Architecture:** One `EngineeringWorkspaceService` owns the active `DesignSession`, artifact payloads, solver registry, and job runner. React and WebMCP call the same service methods; a WebGPU viewport renders semantic CAD and result artifacts without changing design state.

**Tech Stack:** React 19, TypeScript 7, Three.js 0.185 WebGPU renderer, Zod 4, WebMCP, Vitest/Testing Library, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-29-browser-native-cad-platform-design.md`

## Global Constraints

- Execute after the exact CAD, structural runtime, mechanism, and thermal plans pass their automated gates.
- The app has no primary physics discipline; studies are peer tools over one document.
- UI gestures and WebMCP calls must use identical typed transactions and job services.
- Never label partial, unconverged, unsupported, or automated-only evidence as verified.
- No WebGL, saved-result, synthetic geometry, or CPU-solver fallback when a required alpha capability is unavailable.
- Split `FoundationJourney.tsx` before further growth; keep every new or modified production file below 300 lines.

---

### Task 1: WebGPU semantic viewport

**Files:**
- Create: `src/viewer/webgpu-renderer.ts`
- Create: `src/viewer/semantic-scene.ts`
- Create: `src/viewer/semantic-picking.ts`
- Create: `src/viewer/result-layers.ts`
- Modify: `src/viewer/field-renderer.ts`
- Modify: `src/viewer/FieldViewer.tsx`
- Test: `src/viewer/webgpu-renderer.test.ts`
- Test: `src/viewer/semantic-picking.test.ts`
- Test: `src/viewer/result-layers.test.ts`

**Interfaces:**
- Consumes: semantic CAD tessellation, assembly transforms, structural/thermal fields, topology surfaces, mechanism frames.
- Produces: `SemanticViewport` with `setDocument`, `setSelection`, `setResultLayer`, `setMechanismFrame`, `capture`, and `dispose`.

- [ ] **Step 1: Write failing renderer-boundary tests**

Require one WebGPU renderer instance, semantic IDs from assembly → component → body → feature → face/edge, selection persistence across a compatible rebuild, explicit selection repair, mutually controlled result layers, complete resource disposal, device loss, and no WebGL construction.

- [ ] **Step 2: Run tests and confirm missing renderer**

Run: `pnpm vitest run src/viewer/webgpu-renderer.test.ts src/viewer/semantic-picking.test.ts src/viewer/result-layers.test.ts`
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement WebGPU renderer and semantic scene**

Load Three's WebGPU renderer lazily after capability acquisition. Build render objects only from artifact payloads, attach stable semantic IDs outside geometry buffers, and keep renderer state out of `DesignDocument`. Support PBR geometry, edges, outlines, clipping/section planes, measurements, topology density, displacement/stress, temperature/flux, and mechanism transforms.

- [ ] **Step 4: Run viewport tests and commit**

Run: `pnpm vitest run src/viewer && pnpm build`
Expected: PASS with no WebGL fallback path.

```bash
git add src/viewer/webgpu-renderer.ts src/viewer/webgpu-renderer.test.ts src/viewer/semantic-scene.ts src/viewer/semantic-picking.ts src/viewer/semantic-picking.test.ts src/viewer/result-layers.ts src/viewer/result-layers.test.ts src/viewer/field-renderer.ts src/viewer/FieldViewer.tsx
git commit -m "feat(viewer): render semantic engineering data on WebGPU"
```

### Task 2: Shared engineering workspace service

**Files:**
- Create: `src/workspace/engineering-workspace-service.ts`
- Create: `src/workspace/workspace-events.ts`
- Create: `src/workspace/workspace-inspection.ts`
- Modify: `src/app/useProjectState.ts`
- Modify: `src/app/project-state-types.ts`
- Test: `src/workspace/engineering-workspace-service.test.ts`
- Test: `src/app/useProjectState.races.test.tsx`

**Interfaces:**
- Consumes: `DesignSession`, CAD adapter, artifact store, solver registry, job runner.
- Produces: one service API used unchanged by React and WebMCP; define
  `WorkspaceInspection`, `TransactionPreview`, `ResultComparison`, and
  `ExportApproval` in `workspace-inspection.ts`.

- [ ] **Step 1: Write failing concurrency and authority tests**

Test stale transaction rejection, dry-run without mutation, accepted transaction invalidation, simultaneous user/agent edits, job launch on stale geometry, revision change during a running job, cancellation, result comparison, export approval, and subscriber cleanup.

- [ ] **Step 2: Run tests and confirm service is absent**

Run: `pnpm vitest run src/workspace/engineering-workspace-service.test.ts src/app/useProjectState.races.test.tsx`
Expected: FAIL with missing service.

- [ ] **Step 3: Implement the service**

```ts
export interface EngineeringWorkspaceService {
  inspect(): WorkspaceInspection;
  dryRun(transaction: DesignTransaction, signal?: AbortSignal): Promise<TransactionPreview>;
  apply(transaction: DesignTransaction): Promise<ActionReceipt>;
  rebuild(outputs: readonly CadOutput[], signal?: AbortSignal): Promise<ActionReceipt>;
  launchStudy(studyId: string): Promise<{ readonly jobId: string }>;
  cancelJob(jobId: string): Promise<void>;
  inspectJob(jobId: string): JobLedgerEntry;
  compareResults(leftArtifactId: string, rightArtifactId: string): ResultComparison;
  exportArtifact(artifactId: string, approval: ExportApproval): Promise<Blob>;
  subscribe(listener: (event: WorkspaceEvent) => void): () => void;
}
```

All methods validate current revision and inputs. `dryRun` uses an isolated rebuild and disposes temporary kernel/artifact state. Only `apply` changes design intent; solver completion adds derived artifacts but never accepts a revision.

- [ ] **Step 4: Replace fixture-shaped state orchestration**

Adapt `useProjectState` to subscribe to the service. Preserve existing fixture imports as benchmark-document loaders only. Delete state branches that infer capabilities from fixture IDs.

- [ ] **Step 5: Run state tests and commit**

Run: `pnpm vitest run src/workspace src/app/useProjectState.test.tsx src/app/useProjectState.races.test.tsx src/app/useProjectState.review.test.tsx`
Expected: PASS.

```bash
git add src/workspace/engineering-workspace-service.ts src/workspace/engineering-workspace-service.test.ts src/workspace/workspace-events.ts src/workspace/workspace-inspection.ts src/app/useProjectState.ts src/app/project-state-types.ts src/app/useProjectState.test.tsx src/app/useProjectState.races.test.tsx src/app/useProjectState.review.test.tsx
git commit -m "feat(workspace): unify CAD and solver state"
```

### Task 3: Hybrid CAD and studies workbench

**Files:**
- Create: `src/app/WorkbenchLayout.tsx`
- Create: `src/app/FeatureTree.tsx`
- Create: `src/app/SketchEditor.tsx`
- Create: `src/app/StudyBrowser.tsx`
- Create: `src/app/BoundaryEditor.tsx`
- Create: `src/app/JobDock.tsx`
- Create: `src/app/ResultInspector.tsx`
- Create: `src/app/MechanismTimeline.tsx`
- Modify: `src/app/FoundationJourney.tsx`
- Modify: `src/app/InspectorPanel.tsx`
- Modify: `src/app/workbench.css`
- Test: `src/app/engineering-workbench.test.tsx`
- Test: `src/app/engineering-workbench-accessibility.test.tsx`

**Interfaces:**
- Consumes: workspace inspection/events and `SemanticViewport` selection.
- Produces: manual sketch/feature/assembly editing, study setup, job control, field inspection, comparison, and export flows.

- [ ] **Step 1: Write the user-journey test before UI code**

Exercise: create sketch → constrain dimensions → extrude → edit dimension → rebuild → place component → create mate/joint → add material/selections → define structural and thermal studies → launch/cancel/relaunch → run topology → compare/re-analyze → play mechanism → export. Assert every action calls the workspace service and renders typed errors/evidence.

- [ ] **Step 2: Add accessibility and responsive tests**

Require keyboard operation, visible focus, labels for all controls, error summaries linked to fields, reduced-motion behavior, no horizontal overflow at 390 px, and usable desktop layout at 1440 px.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm vitest run src/app/engineering-workbench.test.tsx src/app/engineering-workbench-accessibility.test.tsx`
Expected: FAIL with missing components.

- [ ] **Step 4: Split and implement the workbench**

Keep layout composition in `FoundationJourney`/`WorkbenchLayout`; isolate feature, study, boundary, job, result, and timeline responsibilities in the listed files. Use progressive disclosure: unsupported capabilities remain visible with the exact reason, while failed jobs retain diagnostics and partial artifacts without acceptance actions.

- [ ] **Step 5: Run UI tests and commit**

Run: `pnpm vitest run src/app src/viewer && pnpm build`
Expected: PASS.

```bash
git add src/app/WorkbenchLayout.tsx src/app/FeatureTree.tsx src/app/SketchEditor.tsx src/app/StudyBrowser.tsx src/app/BoundaryEditor.tsx src/app/JobDock.tsx src/app/ResultInspector.tsx src/app/MechanismTimeline.tsx src/app/FoundationJourney.tsx src/app/InspectorPanel.tsx src/app/workbench.css src/app/engineering-workbench.test.tsx src/app/engineering-workbench-accessibility.test.tsx
git commit -m "feat(app): add hybrid CAD and simulation workbench"
```

### Task 4: Shared WebMCP engineering tools

**Files:**
- Create: `src/webmcp/engineering-schemas.ts`
- Create: `src/webmcp/engineering-executors.ts`
- Modify: `src/webmcp/register-tools.ts`
- Modify: `src/webmcp/use-foundation-tools.ts`
- Modify: `src/webmcp/tool-output.ts`
- Test: `src/webmcp/engineering-executors.test.ts`
- Test: `src/webmcp/register-tools.test.ts`

**Interfaces:**
- Consumes: the exact `EngineeringWorkspaceService` instance used by React.
- Produces: `cad_inspect_document`, `cad_dry_run_transaction`, `cad_apply_transaction`, `cad_rebuild`, `engineering_list_capabilities`, `engineering_run_study`, `engineering_cancel_job`, `engineering_inspect_job`, `engineering_compare_results`, and `engineering_export_artifact`.

- [ ] **Step 1: Write failing direct-call and chain tests**

Test discovery, strict inputs, inspection, dry-run, apply, stale revision, rebuild, each solver kind, cancellation, job inspection, comparison, export approval, unsupported capability, worker failure, device loss, and a chain interrupted by a concurrent UI edit. Require concise human summaries plus technical receipts.

- [ ] **Step 2: Run tests and confirm tool schemas are absent**

Run: `pnpm vitest run src/webmcp/engineering-executors.test.ts src/webmcp/register-tools.test.ts`
Expected: FAIL with missing engineering tools.

- [ ] **Step 3: Implement schemas and thin executors**

Executors validate Zod input, call one workspace method, and format its returned receipt/evidence; they do not duplicate CAD, solver, approval, or revision logic. Mark inspection tools read-only. Require visible human approval tokens for accepted mutation, export, and promotion operations.

- [ ] **Step 4: Run WebMCP regression tests and commit**

Run: `pnpm vitest run src/webmcp src/workspace && pnpm build`
Expected: PASS.

```bash
git add src/webmcp/engineering-schemas.ts src/webmcp/engineering-executors.ts src/webmcp/engineering-executors.test.ts src/webmcp/register-tools.ts src/webmcp/register-tools.test.ts src/webmcp/use-foundation-tools.ts src/webmcp/tool-output.ts
git commit -m "feat(webmcp): expose shared engineering tools"
```

### Task 5: Integrated alpha acceptance and release proof

**Files:**
- Create: `src/acceptance/engineering-alpha-gate.ts`
- Create: `src/acceptance/engineering-alpha-gate.test.ts`
- Create: `docs/testing/engineering-alpha-live-gate.md`
- Modify: `docs/hackathon/product-demo-contract.md`

**Interfaces:**
- Consumes: exact CAD, WebGPU viewport, all three adapters, workspace service, WebMCP tools, drone and cobot documents.
- Produces: one fail-closed acceptance report matching spec lines 262–280 and the submission contract.

- [ ] **Step 1: Write the complete automated gate test**

Require exact author/edit/rebuild/STEP round trip; cobot assembly joint/collision/clearance; structural and thermal studies; topology extraction/re-analysis/export; UI and WebMCP parity; cancellation; two non-privileged geometries; artifact/revision provenance; and all discipline-specific gate reports. Reject a report missing live-browser evidence.

- [ ] **Step 2: Run the complete automated closeout**

Run sequentially: `pnpm check && git diff --check`
Expected: Vitest, TypeScript/Vite build, Wasm build, and Rust tests all pass. Record counts; do not call this live proof.

- [ ] **Step 3: Run the live browser and WebMCP journey**

Run: `pnpm dev --host 127.0.0.1`
At desktop and 390 px widths, execute the full journey through UI controls, then repeat inspect/edit/run/cancel/compare/export through discovered WebMCP tools. Confirm real WebGPU adapter/device, OCCT and solver workers, no fallback, no console errors, no overflow, and visible typed failures. Record hashes, timings, thresholds, screenshots, and any unavailable gate in `docs/testing/engineering-alpha-live-gate.md`.

- [ ] **Step 4: Update the demo contract from measured capability**

List only live-passed CAD operations, studies, tools, truth levels, limits, and exports. Move anything not proven into explicit deferrals; do not soften the acceptance gate.

- [ ] **Step 5: Commit the alpha checkpoint**

```bash
git add src/acceptance/engineering-alpha-gate.ts src/acceptance/engineering-alpha-gate.test.ts docs/testing/engineering-alpha-live-gate.md docs/hackathon/product-demo-contract.md
git commit -m "test(alpha): prove integrated engineering workflow"
```
