# WebGPU Physical Topology Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the synthetic density probe with an interactive, physically dimensioned WebGPU topology optimizer that agrees with the independent Rust/Wasm verifier.

**Architecture:** TypeScript compiles an immutable `OptimizationStudy` into structure-of-arrays GPU buffers. WGSL kernels apply Hex8 elasticity, solve displacement and modal systems, filter sensitivities, and update densities. The UI receives progressive immutable snapshots; converged candidates are independently verified through Wasm before they can be promoted.

**Tech Stack:** TypeScript 7, WebGPU/WGSL, Zod 4, Vitest, Rust/Wasm reference fixtures.

**Spec:** `docs/superpowers/specs/2026-08-26-manufacturing-grade-drone-topology-design.md`

## Global Constraints
- Complete both physical reference plans first.
- Use SI units at every boundary and `f32` on GPU; compare against the Rust `f64` implementation with locked tolerances.
- No CPU optimizer, saved-result, or synthetic fallback when WebGPU is unavailable.
- Deterministic reductions, seeds, workgroup shapes, and update order are required for reproducible evidence.
- Device loss, cancellation, non-convergence, numerical mismatch, and invalid studies fail visibly.
- Keep every source file at or below 300 LOC.

---

### Task 1: Define solver contracts and compile physical studies

**Files:**
- Create: `src/solver/contracts.ts`
- Create: `src/solver/study-compiler.ts`
- Test: `src/solver/study-compiler.test.ts`

**Interfaces:**
- Produces: `TopologySolver`, `SolverProgress`, `SolverResult`, `CompiledGpuStudy`, `compileGpuStudy()`.

- [ ] **Step 1: Write failing tests for units, domain masks, load cases, and packed offsets**

```ts
const compiled = compileGpuStudy(PA12_FPV_REFERENCE_STUDY.study);
expect(compiled.units).toEqual({ length: "m", force: "N", stress: "Pa" });
expect(compiled.fixedDensity.every(x => x === 0 || x === 1)).toBe(true);
expect(compiled.loadCases).toHaveLength(6);
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/solver/study-compiler.test.ts`

Expected: FAIL because the solver contracts do not exist.

- [ ] **Step 3: Implement strict compilation into typed structure-of-arrays buffers**

Reject overlapping required-solid/required-void masks, unbalanced free-flight cases, missing material evidence, and grids exceeding the device-independent product limit.

- [ ] **Step 4: Run compiler tests**

Run: `pnpm vitest run src/solver/study-compiler.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/solver
git commit -m "feat(solver): compile physical gpu studies"
```

### Task 2: Implement the WebGPU elasticity operator and PCG

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vitest.config.ts`
- Create: `src/solver/webgpu/runtime.ts`
- Create: `src/solver/webgpu/buffer-layout.ts`
- Create: `src/solver/webgpu/pcg.ts`
- Create: `src/solver/webgpu/elasticity.wgsl`
- Create: `src/solver/webgpu/vector.wgsl`
- Create: `src/solver/webgpu/reduction.wgsl`
- Test: `src/solver/webgpu/elasticity.test.ts`

**Interfaces:**
- Produces: `GpuSolverRuntime`, `applyElasticity()`, `solvePcg()`.

- [ ] **Step 1: Install the pinned browser test provider and write failing fixture comparisons**

Run: `pnpm add -D @vitest/browser-playwright@4.1.11 playwright@1.62.1 && pnpm exec playwright install chromium`

Configure a Chromium browser project in `vitest.config.ts`; preserve the existing jsdom
project for DOM/unit tests. Launch the browser project with WebGPU enabled and fail the
suite explicitly when adapter/device acquisition is unavailable.

Compare a small cantilever and free-flight balanced fixture against committed Rust/Wasm outputs for displacement, compliance, reactions, and residual reporting.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/solver/webgpu/elasticity.test.ts`

Expected: FAIL because the WebGPU operator is absent.

- [ ] **Step 3: Implement gather/apply/scatter kernels and deterministic PCG reductions**

Use fixed workgroup sizes, compensated partial sums, explicit buffer ownership, error scopes, and one runtime disposal path. Do not use atomics for global floating-point sums.

- [ ] **Step 4: Run the GPU fixture gate in a WebGPU-capable browser**

Run: `pnpm vitest run --browser src/solver/webgpu/elasticity.test.ts`

Expected: relative displacement L2 at most `1e-3`, compliance error at most `2e-3`, force balance at most `1e-4` of applied load, and reported residual at most `1e-5`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/solver/webgpu
git commit -m "feat(solver): solve elasticity on webgpu"
```

### Task 3: Add geometric multigrid preconditioning

**Files:**
- Create: `src/solver/webgpu/grid-hierarchy.ts`
- Create: `src/solver/webgpu/multigrid.ts`
- Create: `src/solver/webgpu/restrict.wgsl`
- Create: `src/solver/webgpu/prolong.wgsl`
- Test: `src/solver/webgpu/multigrid.test.ts`

**Interfaces:**
- Produces: `buildGridHierarchy()`, `applyVcycle()`.

- [ ] **Step 1: Write failing convergence and boundary-preservation tests**

Assert required-solid/void masks survive restriction, a V-cycle reduces residual, and PCG iterations improve over Jacobi on the locked medium fixture.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run --browser src/solver/webgpu/multigrid.test.ts`

Expected: FAIL because the hierarchy is absent.

- [ ] **Step 3: Implement matrix-free restriction, prolongation, smoothing, and coarse solve**

Keep levels power-of-two compatible and report an explicit unsupported-grid error rather than silently resizing geometry.

- [ ] **Step 4: Run the multigrid tests**

Run: `pnpm vitest run --browser src/solver/webgpu/multigrid.test.ts`

Expected: PASS and at least a 2x PCG iteration reduction on the locked fixture.

- [ ] **Step 5: Commit**

```bash
git add src/solver/webgpu
git commit -m "feat(solver): precondition elasticity with multigrid"
```

### Task 4: Implement filtering, SIMP sensitivities, and constrained updates

**Files:**
- Create: `src/solver/webgpu/density-filter.wgsl`
- Create: `src/solver/webgpu/sensitivity.wgsl`
- Create: `src/solver/mma.ts`
- Create: `src/solver/optimizer.ts`
- Test: `src/solver/optimizer.test.ts`

**Interfaces:**
- Produces: `runOptimizationIteration()`, `updateMma()`, multi-load smooth stress aggregation.

- [ ] **Step 1: Write failing finite-difference and constraint tests**

Check compliance and K-S stress sensitivities against central differences, monotonic projection, preserved masks, exact volume accounting, and infeasible-study reporting.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run --browser src/solver/optimizer.test.ts`

Expected: FAIL because physical density optimization is absent.

- [ ] **Step 3: Implement filtered SIMP with continuation and MMA updates**

Use density and sensitivity filtering, smooth Heaviside projection, penalization continuation, multiple load cases, stress aggregation, move limits, and hard-bound residuals. Never label a candidate converged while any bound is violated.

- [ ] **Step 4: Run optimizer tests**

Run: `pnpm vitest run --browser src/solver/optimizer.test.ts`

Expected: PASS; finite-difference relative error is at most `5e-3` on the locked grid.

- [ ] **Step 5: Commit**

```bash
git add src/solver
git commit -m "feat(topology): optimize physical density fields"
```

### Task 5: Add modal constraints and progressive execution

**Files:**
- Create: `src/solver/webgpu/modal.ts`
- Create: `src/solver/webgpu/modal.wgsl`
- Create: `src/solver/run-topology-study.ts`
- Modify: `src/optimization/topology-probe.ts`
- Modify: `src/app/useProjectState.ts`
- Test: `src/solver/run-topology-study.test.ts`

**Interfaces:**
- Produces: `solveModes()`, `runTopologyStudy(study, signal, onProgress)`.

- [ ] **Step 1: Write failing modal, progress, cancellation, and device-loss tests**

Assert mode ordering/residuals against Rust, monotonic iteration numbers, immutable coarse-to-fine snapshots, abort cleanup, and no promotion before independent verification.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run --browser src/solver/run-topology-study.test.ts`

Expected: FAIL because the integrated solver does not exist.

- [ ] **Step 3: Implement matrix-free LOBPCG and the progressive controller**

Run preview, converged, and verified phases explicitly. Replace product use of the synthetic probe; retain its fixture only for regression history.

- [ ] **Step 4: Run the physical cross-verification gate**

Run: `pnpm check && pnpm vitest run --browser src/solver`

Expected: all gates pass; locked WebGPU/Rust displacement, compliance, balance, stress, and frequency tolerances are recorded in `docs/testing/webgpu-physical-gate.md`.

- [ ] **Step 5: Commit**

```bash
git add src/solver src/optimization src/app/useProjectState.ts docs/testing/webgpu-physical-gate.md
git commit -m "feat(topology): run verified webgpu optimization"
```
