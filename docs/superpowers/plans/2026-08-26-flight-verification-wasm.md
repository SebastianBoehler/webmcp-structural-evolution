# Flight Verification and Wasm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Rust FEM core with free-flight equilibrium, stress and modal evidence, expose it through Wasm, and compile the physical PA12 FPV study.

**Architecture:** Independent Rust modules balance free-flight loads, recover stress, and solve modes with explicit residuals. A serde-Wasm boundary returns typed SI evidence to the application; the sample fixture owns sourced assumptions.

**Tech Stack:** Rust 2021, wasm-bindgen 0.2.127, serde 1.0.229, serde-wasm-bindgen 0.6.5, TypeScript 7, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-manufacturing-grade-drone-topology-design.md`

## Global Constraints
- First complete `2026-08-26-physical-reference-solver.md`.
- Whole-frame cases use inertia relief; arm-detail cases use actual bolted roots.
- Equivalent-static landing and impact never imply transient crash validation.
- Failed residual, equilibrium, or mesh checks block verified status.
- Keep every source file at or below 300 LOC.

---

### Task 1: Add inertia relief, stress recovery, and modal verification

**Files:**
- Create: `crates/reference/src/fem/inertia_relief.rs`
- Create: `crates/reference/src/fem/stress.rs`
- Create: `crates/reference/src/fem/modal.rs`
- Test: `crates/reference/tests/fem_flight.rs`

**Interfaces:**
- Produces: `balance_free_flight_loads()`, `recover_von_mises()`, `solve_modes(operator, mass, count) -> ModalResult`.

- [ ] **Step 1: Write failing flight tests**

```rust
#[test]
fn inertia_relief_balances_force_and_moment() {
    let balanced = balance_free_flight_loads(&quad_fixture()).unwrap();
    assert_vector_norm_lt(total_force(&balanced), 1e-9);
    assert_vector_norm_lt(total_moment(&balanced), 1e-9);
}

#[test]
fn first_modes_are_positive_and_mass_normalized() {
    let modes = solve_fixture_modes(6);
    assert!(modes.frequencies_hz.windows(2).all(|w| w[0] <= w[1]));
    assert_mass_orthonormal(&modes.vectors, 1e-5);
}
```

- [ ] **Step 2: Verify failure**

Run: `cargo test --manifest-path crates/reference/Cargo.toml --test fem_flight`

Expected: compile failure because the flight-analysis modules do not exist.

- [ ] **Step 3: Implement balanced loads, Gauss-point stress, and subspace iteration**

```rust
pub struct ModalResult { pub frequencies_hz: Vec<f64>, pub vectors: Vec<Vec<f64>>, pub residuals: Vec<f64> }

pub fn recover_von_mises(op: &ElasticityOperator, displacement: &[f64]) -> Vec<f64> {
    op.elements().map(|element| max_gauss_von_mises(element, displacement)).collect()
}
```

Use deterministic seeded vectors and reject modal evidence when an eigenpair residual exceeds `1e-5`.

- [ ] **Step 4: Run flight tests**

Run: `cargo test --manifest-path crates/reference/Cargo.toml --test fem_flight`

Expected: PASS for equilibrium, stress scaling, mode ordering, orthogonality, and failure reporting.

- [ ] **Step 5: Commit**

```bash
git add crates/reference/src/fem crates/reference/tests/fem_flight.rs
git commit -m "feat(fem): verify free-flight stress and modal response"
```

### Task 2: Expose the independent verifier through Wasm

**Files:**
- Modify: `crates/reference/Cargo.toml`
- Modify: `crates/reference/src/lib.rs`
- Create: `crates/reference/src/verification.rs`
- Modify: `src/reference/index.ts`
- Test: `src/reference/verification.test.ts`

**Interfaces:**
- Produces: `verifyPhysicalCandidate(input: PhysicalCandidateInput): Promise<PhysicalVerification>`.

- [ ] **Step 1: Write a failing Wasm contract test**

```ts
it("returns physical units, equilibrium, residual, stress, and modes", async () => {
  const result = await verifyPhysicalCandidate(referenceCandidate);
  expect(result.units).toEqual({ displacement: "m", stress: "Pa", frequency: "Hz" });
  expect(result.status).toBe("verified");
  expect(result.maxVonMisesPa).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/reference/verification.test.ts`

Expected: FAIL because the Wasm binding is missing.

- [ ] **Step 3: Add serialization and the binding**

Add `serde = { version = "1.0.229", features = ["derive"] }` and `serde-wasm-bindgen = "0.6.5"`.

```rust
#[wasm_bindgen]
pub fn verify_physical_candidate(input: JsValue) -> Result<JsValue, JsValue> {
    let input: PhysicalCandidateInput = serde_wasm_bindgen::from_value(input)?;
    serde_wasm_bindgen::to_value(&verify_candidate(input)).map_err(Into::into)
}
```

- [ ] **Step 4: Build Wasm and run reference tests**

Run: `pnpm wasm:build && pnpm vitest run src/reference && cargo test --manifest-path crates/reference/Cargo.toml`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/reference src/reference
git commit -m "feat(reference): expose independent physical verification"
```

### Task 3: Compile the real PA12 5-inch drone study

**Files:**
- Create: `src/samples/pa12-fpv-frame.ts`
- Create: `src/samples/pa12-fpv-frame.test.ts`
- Modify: `src/app/project-inspection.ts`
- Create: `docs/testing/physical-reference-gate.md`

**Interfaces:**
- Produces: `PA12_FPV_REFERENCE_STUDY` with sourced assumptions and six named cases.

- [ ] **Step 1: Write the failing fixture test**

```ts
expect(PA12_FPV_REFERENCE_STUDY.study.loadCases.map(x => x.id)).toEqual([
  "hover", "max-collective", "max-roll", "motor-torque-imbalance", "hard-landing-equivalent", "lateral-impact-equivalent",
]);
expect(PA12_FPV_REFERENCE_STUDY.study.material.process).toBe("formlabs-fuse-sls");
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/samples/pa12-fpv-frame.test.ts`

Expected: FAIL because the reference study is absent.

- [ ] **Step 3: Implement the sourced fixture and explicit assumptions**

Use exact component revisions, mass properties, arm roots, motor mounts, avionics stack, cable corridors, tool access, PA12 source, design allowable derivation, and equivalent-static labels.

- [ ] **Step 4: Run the full physical gate**

Run: `pnpm check`

Expected: PASS; UI inspection names physical units and never shows normalized compliance as flight evidence.

- [ ] **Step 5: Commit**

```bash
git add src/samples src/app/project-inspection.ts docs/testing/physical-reference-gate.md
git commit -m "feat(samples): define physical pa12 fpv reference study"
```
