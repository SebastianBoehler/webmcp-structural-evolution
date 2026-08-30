# Steady Thermal Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded steady-state heat conduction on exact design geometry with WebGPU execution, energy-balance evidence, and independent Rust/Wasm checks.

**Architecture:** Compile thermal studies and named semantic selections onto a bounded voxel domain, solve the scalar conduction system with a matrix-free WebGPU PCG adapter, and store temperature/heat-flux fields through the shared job runtime. Reuse structural GPU utilities only where the mathematical operation and validation contract are identical.

**Tech Stack:** TypeScript 7, Zod 4, Vitest 4, WebGPU/WGSL, Rust/Wasm.

**Spec:** `docs/superpowers/specs/2026-08-29-browser-native-cad-platform-design.md`

## Global Constraints

- Complete `2026-08-30-exact-cad-authoring.md` and `2026-08-30-structural-solver-runtime.md` Tasks 1–3 first.
- Scope is linear, isotropic, steady-state conduction with fixed-temperature and heat-flux boundaries.
- Reject studies without a temperature reference; do not regularize a singular system silently.
- A verified result requires residual, finite fields, energy balance, analytical fixtures, and Wasm agreement.
- No transient, convective-fluid, radiative, phase-change, or temperature-dependent material claims.
- Keep every new production file below 300 lines.

---

### Task 1: Thermal contracts and study compiler

**Files:**
- Create: `src/solver/thermal/thermal-contract.ts`
- Create: `src/solver/thermal/compile-thermal-study.ts`
- Modify: `src/engineering/study-schema.ts`
- Test: `src/solver/thermal/thermal-contract.test.ts`
- Test: `src/solver/thermal/compile-thermal-study.test.ts`

**Interfaces:**
- Consumes: `thermal-steady` studies, exact body/SDF artifacts, named selections, thermal materials.
- Produces: `ThermalInput` containing grid, active-cell mask, conductivity field, Dirichlet cells, Neumann faces, and capability metadata.

- [ ] **Step 1: Write failing strict-contract tests**

```ts
it("rejects a steady study without a fixed-temperature boundary", () => {
  expect(() => compileThermalStudy(document, artifacts, "unanchored-heat"))
    .toThrow("Steady thermal study requires at least one temperature boundary");
});
```

Also test unresolved selections, overlapping contradictory temperatures, non-positive/non-finite conductivity, empty rasterized boundaries, stale geometry, disconnected unanchored material islands, and capability limits.

- [ ] **Step 2: Run tests and confirm missing modules**

Run: `pnpm vitest run src/solver/thermal/thermal-contract.test.ts src/solver/thermal/compile-thermal-study.test.ts`
Expected: FAIL with missing thermal modules.

- [ ] **Step 3: Implement schemas and conservative boundary rasterization**

```ts
export interface ThermalBoundarySet {
  readonly temperatures: readonly { selectionId: string; temperatureK: number }[];
  readonly heatFluxes: readonly { selectionId: string; heatFluxWm2: number }[];
}
```

Use harmonic conductivity at material interfaces. Record selected face area and rasterization error; reject a boundary whose represented area differs by more than the adapter tolerance.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run src/solver/thermal/thermal-contract.test.ts src/solver/thermal/compile-thermal-study.test.ts`
Expected: PASS.

```bash
git add src/solver/thermal src/engineering/study-schema.ts
git commit -m "feat(thermal): compile steady conduction studies"
```

### Task 2: WebGPU conduction operator and adapter

**Files:**
- Create: `src/solver/thermal/conduction.wgsl`
- Create: `src/solver/thermal/heat-flux.wgsl`
- Create: `src/solver/thermal/webgpu-thermal-adapter.ts`
- Modify: `src/solver/structural/pcg.ts`
- Test: `src/solver/thermal/webgpu-thermal-adapter.test.ts`

**Interfaces:**
- Consumes: `ThermalInput`, shared PCG primitives, WebGPU device.
- Produces: `ThermalResult` with temperature/heat-flux fields, residual, heat-in/out, energy-balance error, iteration count, and device evidence.

- [ ] **Step 1: Write analytical tests**

For a 1 m bar with ends at 300 K and 400 K, require the linear field within `0.5 K`. For a two-material wall, require heat rate within `2%` of `ΔT/(L1/(k1A)+L2/(k2A))`. Require relative residual at or below `1e-6` and energy imbalance below `0.1%` of total imposed heat.

- [ ] **Step 2: Run tests and verify the adapter is absent**

Run: `pnpm vitest run src/solver/thermal/webgpu-thermal-adapter.test.ts`
Expected: FAIL with missing adapter.

- [ ] **Step 3: Generalize PCG without coupling physics modules**

Expose buffer-level `applyOperator`, `precondition`, `dot`, `axpy`, and `residualNorm` callbacks. Keep structural and thermal convergence policies in their adapters; do not add a physics switch inside shared vector utilities.

- [ ] **Step 4: Implement conduction and flux kernels**

Apply finite-volume face conductances, fixed-temperature rows, and heat-flux source terms. Check cancellation between solver iterations and device loss after every submitted batch. Derive face heat flux from the converged temperature field and conductivity.

- [ ] **Step 5: Run thermal and structural regression tests**

Run: `pnpm vitest run src/solver/thermal src/solver/structural && pnpm build`
Expected: PASS; structural results remain inside their locked tolerances.

- [ ] **Step 6: Commit WebGPU thermal solve**

```bash
git add src/solver/thermal src/solver/structural/pcg.ts
git commit -m "feat(thermal): solve steady conduction on WebGPU"
```

### Task 3: Independent Rust/Wasm thermal verifier

**Files:**
- Create: `crates/reference/src/thermal.rs`
- Modify: `crates/reference/src/lib.rs`
- Modify: `src/reference/index.ts`
- Create: `src/solver/thermal/verify-thermal-result.ts`
- Test: `src/solver/thermal/verify-thermal-result.test.ts`
- Test: `crates/reference/src/thermal.rs`

**Interfaces:**
- Consumes: locked analytical fixture inputs and WebGPU result fields.
- Produces: `verifyThermalResult(input, result): Promise<ThermalVerification>`.

- [ ] **Step 1: Write failing verifier tests**

Require the one-material bar, two-material wall, and mixed temperature/flux fixture. Reject different grid dimensions, non-finite fields, relative L2 temperature error above `1e-3`, heat-rate error above `2e-3`, or energy imbalance above `1e-3`.

- [ ] **Step 2: Run Rust and TypeScript tests to confirm missing verifier**

Run: `cargo test --manifest-path crates/reference/Cargo.toml thermal && pnpm vitest run src/solver/thermal/verify-thermal-result.test.ts`
Expected: FAIL because thermal reference exports do not exist.

- [ ] **Step 3: Implement a CPU finite-volume reference**

Use `f64` accumulation and a deterministic conjugate-gradient solve in Rust. Keep it independent of the WGSL code and export only locked fixture evaluation plus field arrays and evidence scalars.

- [ ] **Step 4: Build Wasm and run agreement tests**

Run: `pnpm wasm:build && cargo test --manifest-path crates/reference/Cargo.toml thermal && pnpm vitest run src/solver/thermal`
Expected: PASS.

- [ ] **Step 5: Commit verifier**

```bash
git add crates/reference/src/thermal.rs crates/reference/src/lib.rs src/reference/index.ts src/solver/thermal/verify-thermal-result.ts src/solver/thermal/verify-thermal-result.test.ts
git commit -m "test(thermal): verify WebGPU conduction independently"
```

### Task 4: Cobot-link thermal study and browser gate

**Files:**
- Create: `src/samples/cobot/cobot-thermal-study.ts`
- Create: `src/solver/thermal/browser-thermal-gate.ts`
- Create: `docs/testing/thermal-browser-gate.md`
- Test: `src/samples/cobot/cobot-thermal-study.test.ts`
- Test: `src/solver/thermal/browser-thermal-gate.test.ts`

**Interfaces:**
- Consumes: exact cobot-link body, materials, named mounting/motor selections, thermal adapter, job runner.
- Produces: truth-labelled temperature/flux artifacts and a serialized live gate report.

- [ ] **Step 1: Write benchmark completeness tests**

Require an aluminum link, fixed base temperature, motor-interface heat flux, nonempty selected areas, converged temperature field, energy balance, cancellation, and source artifact/revision hashes.

- [ ] **Step 2: Implement the benchmark and automated report gate**

Run: `pnpm vitest run src/samples/cobot/cobot-thermal-study.test.ts src/solver/thermal/browser-thermal-gate.test.ts && pnpm check && git diff --check`
Expected: PASS.

- [ ] **Step 3: Run the live browser gate**

Run: `pnpm dev --host 127.0.0.1`
Verify real WebGPU execution, visible temperature and heat-flux fields, evidence metrics, cancellation/restart, and zero console errors. Record device, grid, residual, energy balance, verifier deltas, and timings in `docs/testing/thermal-browser-gate.md`.

- [ ] **Step 4: Commit measured proof**

```bash
git add src/samples/cobot/cobot-thermal-study.ts src/samples/cobot/cobot-thermal-study.test.ts src/solver/thermal/browser-thermal-gate.ts src/solver/thermal/browser-thermal-gate.test.ts docs/testing/thermal-browser-gate.md
git commit -m "test(thermal): prove live cobot conduction workflow"
```
