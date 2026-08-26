# Physical Study and Reference Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish physical SI study contracts and a convergent matrix-free Rust finite-element core.

**Architecture:** TypeScript compiles approved assemblies into immutable physical studies. Rust implements and analytically tests the Hex8 element, structured matrix-free elasticity operator, and PCG solve without sharing WebGPU kernels.

**Tech Stack:** TypeScript 7, Zod 4, Rust 2021, wasm-bindgen 0.2.127, serde 1.0.229, serde-wasm-bindgen 0.6.5, Vitest, Cargo tests.

**Spec:** `docs/superpowers/specs/2026-08-26-manufacturing-grade-drone-topology-design.md`

## Global Constraints
- Complete both component/assembly plans first.
- Use SI units inside every solver boundary; units appear in every result field.
- Whole-frame flight uses inertia relief, not a clamped center.
- Landing and impact are equivalent-static envelopes and are not called transient crash validation.
- Missing material or load evidence blocks dependent verification claims.
- Preserve the old lattice only as a historical regression fixture; remove it from product evidence.
- Keep each source file at or below 300 LOC.

---

### Task 1: Define material, load, objective, and evidence contracts

**Files:**
- Create: `src/domain/material-profile.ts`
- Create: `src/domain/load-case.ts`
- Create: `src/domain/study-model.ts`
- Modify: `src/domain/design.ts`
- Test: `src/domain/study-model.test.ts`

**Interfaces:**
- Produces: `MaterialProfile`, `PhysicalLoadCase`, `OptimizationStudy`, `VerificationEvidence`, `defineMaterialProfile()`, `defineOptimizationStudy()`.

- [ ] **Step 1: Write failing contract tests**

```ts
it("rejects a strength claim without a sourced design allowable", async () => {
  await expect(defineMaterialProfile({ ...pa12, designAllowablePa: undefined }))
    .rejects.toThrow("designAllowablePa");
});

it("requires inertia relief for a free-flight case", async () => {
  await expect(defineOptimizationStudy({ ...study, loadCases: [freeFlightWithoutRelief] }))
    .rejects.toThrow("inertia-relief");
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/domain/study-model.test.ts`

Expected: FAIL because the physical contracts are absent.

- [ ] **Step 3: Implement exact schemas**

```ts
export const ObjectiveSchema = z.object({ kind: z.literal("minimize-mass") }).strict();
export const HardBoundsSchema = z.object({
  maximumMotorDisplacementM: positive,
  maximumMotorRotationRad: positive,
  minimumSafetyFactor: positive,
  excludedFrequencyBandsHz: z.array(z.tuple([positive, positive])),
}).strict();
```

Material profiles include process, source, test method, temperature, density, elastic modulus, Poisson ratio, design allowable, and uncertainty.

- [ ] **Step 4: Run domain tests**

Run: `pnpm vitest run src/domain/design.test.ts src/domain/study-model.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain
git commit -m "feat(domain): define physical optimization studies"
```

### Task 2: Implement and verify the Hex8 element

**Files:**
- Create: `crates/reference/src/fem/mod.rs`
- Create: `crates/reference/src/fem/material.rs`
- Create: `crates/reference/src/fem/hex8.rs`
- Modify: `crates/reference/src/lib.rs`
- Test: `crates/reference/tests/fem_element.rs`

**Interfaces:**
- Produces: `Material::isotropic(youngs_pa, poisson, density_kg_m3)`, `hex8_stiffness(material, cell_m) -> [f64; 576]`, `hex8_mass(material, cell_m) -> [f64; 24]`.

- [ ] **Step 1: Write failing element tests**

```rust
#[test]
fn hex8_stiffness_is_symmetric_and_has_six_rigid_modes() {
    let k = hex8_stiffness(Material::isotropic(1.85e9, 0.39, 1010.0).unwrap(), [0.01; 3]);
    assert_symmetric(&k, 24, 1e-10);
    assert_eq!(near_zero_eigenvalues(&k, 24, 1e-8), 6);
}
```

- [ ] **Step 2: Verify failure**

Run: `cargo test --manifest-path crates/reference/Cargo.toml --test fem_element`

Expected: compile failure because `fem` is undefined.

- [ ] **Step 3: Implement 2x2x2 Gauss integration**

```rust
pub fn hex8_stiffness(material: Material, cell: [f64; 3]) -> [f64; 24 * 24] {
    let mut k = [0.0; 24 * 24];
    for point in gauss_points_2x2x2() {
        let (b, det_j) = strain_displacement(point, cell);
        accumulate_bt_db(&mut k, &b, material.elasticity(), det_j);
    }
    k
}
```

- [ ] **Step 4: Run element tests**

Run: `cargo test --manifest-path crates/reference/Cargo.toml --test fem_element`

Expected: PASS for symmetry, rigid modes, positive strain energy, and unit scaling.

- [ ] **Step 5: Commit**

```bash
git add crates/reference/src crates/reference/tests/fem_element.rs
git commit -m "feat(fem): add physical hexahedral element"
```

### Task 3: Add matrix-free assembly and convergent PCG

**Files:**
- Create: `crates/reference/src/fem/grid.rs`
- Create: `crates/reference/src/fem/operator.rs`
- Create: `crates/reference/src/fem/pcg.rs`
- Test: `crates/reference/tests/fem_cantilever.rs`

**Interfaces:**
- Produces: `StructuredGrid`, `ElasticityOperator::apply()`, `solve_pcg(operator, rhs, tolerance, max_iterations) -> SolveResult`.

- [ ] **Step 1: Write failing analytical and failure tests**

```rust
#[test]
fn cantilever_tip_displacement_matches_beam_solution() {
    let result = solve_cantilever(cantilever_fixture(48, 8, 8));
    assert_relative_eq(result.tip_displacement_m, euler_bernoulli_tip_m(), 0.05);
}

#[test]
fn pcg_reports_non_convergence() {
    assert_eq!(solve_fixture_with_limit(1).status, SolveStatus::NonConverged);
}
```

- [ ] **Step 2: Verify failure**

Run: `cargo test --manifest-path crates/reference/Cargo.toml --test fem_cantilever`

Expected: compile failure for missing grid/operator/PCG modules.

- [ ] **Step 3: Implement matrix-free gather/apply/scatter and Jacobi PCG**

```rust
pub struct SolveResult { pub displacement: Vec<f64>, pub iterations: usize, pub relative_residual: f64, pub status: SolveStatus }

pub fn solve_pcg(op: &ElasticityOperator, rhs: &[f64], tolerance: f64, max_iterations: usize) -> SolveResult {
    validate_solve_input(op, rhs, tolerance, max_iterations);
    pcg_with_diagonal_preconditioner(op, rhs, tolerance, max_iterations)
}
```

- [ ] **Step 4: Run static solver tests**

Run: `cargo test --manifest-path crates/reference/Cargo.toml --test fem_cantilever`

Expected: PASS; residual is at most `1e-8` for the locked cantilever fixture.

- [ ] **Step 5: Commit**

```bash
git add crates/reference/src/fem crates/reference/tests/fem_cantilever.rs
git commit -m "feat(fem): solve structured elasticity with matrix-free pcg"
```

Execution continues in `2026-08-26-flight-verification-wasm.md`.
