# Engineering Visualization and WebMCP Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the physical workflow understandable in seconds and let humans and agents inspect, plan, run, compare, and verify engineering studies through the same live CAD surface.

**Architecture:** Pure presentation models derive viewport overlays, results, and concise evidence from immutable revisions. The workbench uses familiar CAD navigation and direct manipulation. WebMCP exposes state-dependent inspect/preview/execute tools backed by the same application services, while promotion and manufacturing export remain explicit human actions.

**Tech Stack:** React 19, Three.js 0.185, TypeScript 7, WebMCP, Vitest, Testing Library, Chrome WebMCP evals.

**Specs:**
- `docs/superpowers/specs/2026-08-26-manufacturing-grade-drone-topology-design.md`
- `docs/superpowers/specs/2026-08-26-agent-authored-component-ingestion.md`

## Global Constraints
- Complete assembly authoring, physical optimization, and manufacturing plans first.
- The viewport remains primary; no page scroll at supported desktop sizes.
- Use a world grid, axis tripod, transform gizmo, orthographic/perspective views, and standard selection behavior without copying Blender branding.
- Dense raw hashes, JSON, buffers, and timestamps stay behind technical details; default copy names the action, result, implication, and next choice.
- Preview, converged, independently verified, manufacturable, and human-approved are visibly distinct states.
- Agent writes are reversible staged revisions; promotion and export are human-only.
- Keep every source file at or below 300 LOC.

---

### Task 1: Render force, constraint, and result overlays

**Files:**
- Create: `src/viewer/engineering-overlay-model.ts`
- Create: `src/viewer/engineering-overlays.ts`
- Create: `src/viewer/result-field-model.ts`
- Modify: `src/viewer/field-renderer.ts`
- Test: `src/viewer/engineering-overlays.test.ts`

**Interfaces:**
- Produces: `buildLoadOverlays()`, `buildResultField()`, modes `geometry`, `loads`, `displacement`, `stress`, `safety`, `modal`, and `manufacturing`.

- [ ] **Step 1: Write failing semantic and geometry tests**

Assert force arrows use physical scale labels, torque arcs have signed axes, distributed inertia is distinguishable from applied load, legends carry units, and selection summaries exist outside the canvas.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/viewer/engineering-overlays.test.ts`

Expected: FAIL because the overlay models are absent.

- [ ] **Step 3: Implement instanced overlays and bounded color maps**

Use reusable instanced meshes, clipping/peel controls, explicit min/max, perceptually ordered palettes, and warning patterns independent of color. Modal animation must respect reduced motion.

- [ ] **Step 4: Run viewer tests**

Run: `pnpm vitest run src/viewer`

Expected: PASS with renderer resources disposed on mode changes and unmount.

- [ ] **Step 5: Commit**

```bash
git add src/viewer
git commit -m "feat(viewer): visualize physical loads and results"
```

### Task 2: Add familiar CAD navigation and direct manipulation

**Files:**
- Create: `src/viewer/cad-navigation.ts`
- Modify: `src/viewer/transform-gizmo.ts`
- Modify: `src/viewer/FieldViewer.tsx`
- Create: `src/app/ViewportToolbar.tsx`
- Test: `src/viewer/cad-navigation.test.ts`
- Test: `src/app/ViewportToolbar.test.tsx`

**Interfaces:**
- Produces: orbit/pan/zoom, front/top/right/isometric views, frame selection, grid toggle, local/world transforms, snap, and undoable drag previews.

- [ ] **Step 1: Write failing interaction tests**

Assert standard mouse mappings, keyboard-accessible view commands, selected axes, local/world transforms, escape-to-cancel, snap controls, and one staged revision per completed drag.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/viewer/cad-navigation.test.ts src/app/ViewportToolbar.test.tsx`

Expected: FAIL because CAD navigation is incomplete.

- [ ] **Step 3: Implement navigation and preview-only real-time response**

During drag, update constraints and a low-resolution topology preview at a bounded cadence; on release, create one exact branch and require an explicit full optimization. Never present the preview as converged or verified.

- [ ] **Step 4: Run interaction tests**

Run: `pnpm vitest run src/viewer src/app/ViewportToolbar.test.tsx`

Expected: PASS for mouse, keyboard, cancellation, reduced motion, and cleanup.

- [ ] **Step 5: Commit**

```bash
git add src/viewer src/app/ViewportToolbar*
git commit -m "feat(viewer): add cad navigation and direct manipulation"
```

### Task 3: Replace dense diagnostics with decision-oriented evidence

**Files:**
- Create: `src/app/evidence-view-model.ts`
- Modify: `src/app/EvidencePanel.tsx`
- Modify: `src/app/ReceiptLedger.tsx`
- Modify: `src/app/WorkbenchDrawer.tsx`
- Test: `src/app/EvidencePanel.test.tsx`
- Test: `src/app/ReceiptLedger.test.tsx`

**Interfaces:**
- Produces: concise status cards, governing-case summary, before/after deltas, conflict resolution, human-readable receipts, and expandable technical evidence.

- [ ] **Step 1: Write failing judge-readability tests**

Require the default view to answer within one screen: what changed, why, whether it passed, the governing risk, and the next action. Reject raw JSON and full revision hashes outside technical details.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/app/EvidencePanel.test.tsx src/app/ReceiptLedger.test.tsx`

Expected: FAIL against the current dense ledger.

- [ ] **Step 3: Implement progressive disclosure and action copy**

Summaries use component names and short revisions; technical details retain exact IDs, solver residuals, sources, and timestamps. Errors state recovery steps.

- [ ] **Step 4: Run UI tests and build**

Run: `pnpm vitest run src/app && pnpm build`

Expected: PASS with no desktop page overflow.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat(app): make engineering evidence decision readable"
```

### Task 4: Expose inspect-first study and viewport tools

**Files:**
- Create: `src/webmcp/study-schemas.ts`
- Create: `src/webmcp/study-executors.ts`
- Create: `src/webmcp/study-tools.tsx`
- Modify: `src/app/WorkbenchAgentTools.tsx`
- Test: `src/webmcp/study-executors.test.ts`
- Test: `src/webmcp/study-tools.test.tsx`

**Interfaces:**
- Produces tools: `inspect_engineering_context`, `focus_view`, `set_result_view`, `propose_optimization_study`, `run_topology_optimization`, `compare_design_candidates`, `verify_design_candidate`, `prepare_manufacturing_package`.

- [ ] **Step 1: Write failing discovery, stale-state, and permission tests**

Assert read-only inspection is available first, viewport actions update the shared surface, a proposed study names assumptions and evidence gaps, writes need exact revisions, cancellation propagates, and export preparation cannot download or promote.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/webmcp/study-executors.test.ts src/webmcp/study-tools.test.tsx`

Expected: FAIL because physical study tools are absent.

- [ ] **Step 3: Implement dynamic inspect → preview → execute registration**

Adapt Blender Lab MCP's scene-analysis, relationship-query, debugging, and viewport-navigation ideas into narrow typed tools. Do not expose Python, JavaScript, WGSL, Wasm, filesystem paths, network fetches, or a generic execute command.

- [ ] **Step 4: Run WebMCP tests**

Run: `pnpm vitest run src/webmcp`

Expected: PASS for schema budgets, tool annotations, state-dependent availability, receipts, and abort behavior.

- [ ] **Step 5: Commit**

```bash
git add src/webmcp src/app/WorkbenchAgentTools.tsx
git commit -m "feat(webmcp): expose physical design collaboration tools"
```

### Task 5: Gate the complete human-agent design journey

**Files:**
- Create: `docs/testing/engineering-journey-evals.json`
- Create: `docs/testing/manufacturing-journey-gate.md`
- Modify: `src/app/FoundationJourney.tsx`
- Test: `src/app/FoundationJourney.test.tsx`

**Interfaces:**
- Verifies prompt → inspect → import/place/constrain → propose study → optimize → compare → verify → human approve/export.

- [ ] **Step 1: Add deterministic positive, ambiguous, negative, stale, and interrupted evals**

Include a judge prompt that asks for a PA12 5-inch drone frame and expects an agent-authored assembly, protected regions, physical study, visible alternatives, governing evidence, and no unsafe export.

- [ ] **Step 2: Run the complete local gate**

Run: `pnpm check`

Expected: TypeScript, unit, Wasm, Rust, and production builds pass.

- [ ] **Step 3: Verify in the real in-app browser**

Run: `pnpm dev --host 127.0.0.1`

Exercise tool discovery, direct calls, full chain, cancellation, device loss, stale revisions, keyboard controls, light/dark themes, supported viewport sizes, and 3MF preparation. Capture measured timings and screenshots; do not mark unavailable WebMCP/WebGPU checks as passed.

- [ ] **Step 4: Run official WebMCP evals and record evidence**

Use smoke mode for every tool and probabilistic selection evals when a configured backend is available. Record tool success, intervention count, recovery from stale state, solver time, verification time, and export validation.

- [ ] **Step 5: Commit**

```bash
git add docs/testing src/app/FoundationJourney*
git commit -m "test(app): gate the complete agentic engineering journey"
```
