# Organic Load-Path Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and render a smooth, porous, density-derived structural web for the live reference-drone topology study.

**Architecture:** A Rust post-processing stage grows a deterministic face-connected web from protected load paths using the solved density as its priority, then the existing structural solver recomputes all result fields on that density. A separate TypeScript signed-distance reconstruction turns the same occupied cells into a smooth Marching Cubes surface while preserving grid-space field mapping.

**Tech Stack:** Rust/Wasm reference solver, TypeScript, Three.js Marching Cubes, Vitest, Cargo tests.

**Spec:** `docs/superpowers/specs/2026-09-03-organic-load-path-topology.md`

## Global Constraints

- Reconstruction applies only when `load_path_guides` is non-empty; the legacy demo fixture remains unchanged.
- Passive solids and required path cells remain material; passive voids remain exactly zero.
- Reconstructed cells are face-connected and selected deterministically from the solved density.
- Structural fields and metrics are recomputed after reconstruction.
- The density material threshold is exactly `0.32`; the signed-distance display threshold is exactly `0.5`.
- No new dependency or fallback data path.
- Results remain `interactive-estimate`, unverified, unaccepted, and human-reviewed.
- Keep new or modified source files below the repository's 300 LOC soft limit.

---

### Task 1: Solver-side connected web reconstruction

**Files:**
- Create: `crates/reference/src/topology/reconstruct.rs`
- Modify: `crates/reference/src/topology/mod.rs`
- Modify: `crates/reference/src/topology/optimize.rs`
- Modify: `src/reference/pkg/webmcp_reference_bg.wasm`
- Test: `crates/reference/src/topology/reconstruct.rs`
- Test: `src/reference/index.test.ts`

**Interfaces:**
- Consumes: `Grid`, pre-reconstruction `density: &[f32]`, `required_path: &[bool]`, and the preset target fraction.
- Produces: `pub(crate) fn reconstruct_load_path_web(grid: &Grid, solved_density: &[f32], required_path: &[bool], target: f32) -> Vec<f32>`.
- The returned density is passed into the existing `compliance_and_sensitivity` and `load_case_fields` calls.

- [ ] **Step 1: Add failing Rust tests for reconstruction invariants**

```rust
#[test]
fn reconstructed_web_preserves_seeds_voids_connectivity_and_target() {
    let grid = reconstruction_fixture();
    let solved = fixture_density(&grid);
    let path = fixture_required_path(&grid);
    let result = reconstruct_load_path_web(&grid, &solved, &path, 0.35);
    assert!(path.iter().enumerate().all(|(i, keep)| !keep || result[i] >= 0.32));
    assert!(grid.passive_void.iter().enumerate().all(|(i, void)| !void || result[i] == 0.0));
    assert!(occupied_cells_are_face_connected(&grid, &result, 0.32));
    assert!((material_fraction(&grid, &result) - 0.35).abs() <= 1.0 / non_void_count(&grid) as f32);
}

#[test]
fn reconstruction_is_deterministic_and_density_guided() {
    let grid = reconstruction_fixture();
    let solved = fixture_density(&grid);
    let path = fixture_required_path(&grid);
    let first = reconstruct_load_path_web(&grid, &solved, &path, 0.35);
    let second = reconstruct_load_path_web(&grid, &solved, &path, 0.35);
    assert_eq!(first, second);
    assert!(first[preferred_high_density_cell(&grid)] > first[available_low_density_cell(&grid)]);
}
```

- [ ] **Step 2: Run the focused Rust tests and confirm they fail**

Run: `cargo test --manifest-path crates/reference/Cargo.toml reconstruct`

Expected: FAIL because `reconstruct_load_path_web` and its module do not exist.

- [ ] **Step 3: Implement deterministic face-connected region growth**

```rust
pub(crate) fn reconstruct_load_path_web(
    grid: &Grid,
    solved_density: &[f32],
    required_path: &[bool],
    target: f32,
) -> Vec<f32> {
    assert_eq!(solved_density.len(), grid.node_count());
    assert_eq!(required_path.len(), grid.node_count());
    let mut occupied = required_path.iter().zip(&grid.passive_solid)
        .map(|(path, solid)| *path || *solid).collect::<Vec<_>>();
    grow_face_connected_by_density(grid, solved_density, &mut occupied, target);
    occupied.iter().enumerate().map(|(index, active)| {
        if grid.passive_void[index] { 0.0 } else if *active { 1.0 } else { 0.02 }
    }).collect()
}
```

`grow_face_connected_by_density` must expand only from the six face neighbors of the current web. Each layer ranks candidates by descending solved density, then descending count of occupied face neighbors, then ascending cell index. It stops at the nearest whole-cell material count to the target and never removes required seeds.

- [ ] **Step 4: Insert reconstruction before final structural evaluation**

```rust
let path = enforce_connectivity(&grid, &mut density, target);
if prune_islands { remove_floating_material(&grid, &mut density, &path, target); }
if !grid.load_path_guides.is_empty() {
    density = reconstruct_load_path_web(&grid, &density, &path, target);
}
let (final_compliance, max_displacement, _, max_stress, displacement, stress) =
    compliance_and_sensitivity(&grid, &springs, &density);
```

- [ ] **Step 5: Verify Rust behavior, rebuild Wasm, and cover the JS bridge**

Run: `cargo test --manifest-path crates/reference/Cargo.toml reconstruct`

Expected: PASS.

Run: `pnpm wasm:build`

Expected: PASS and update the tracked Wasm artifact.

Add an assembly-backed `src/reference/index.test.ts` assertion that the returned material fraction equals the mean returned density over non-void cells within `1e-5`, and that the returned case stress/vector fields still match the reconstructed grid length.

Run: `pnpm test:run src/reference/index.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/reference/src/topology/reconstruct.rs crates/reference/src/topology/mod.rs crates/reference/src/topology/optimize.rs src/reference/pkg/webmcp_reference_bg.wasm src/reference/index.test.ts
git commit -m "feat(topology): reconstruct connected organic load paths"
```

### Task 2: Signed-distance organic surface extraction

**Files:**
- Create: `src/viewer/topology-distance-field.ts`
- Create: `src/viewer/topology-distance-field.test.ts`
- Modify: `src/viewer/topology-surface.ts`
- Modify: `src/viewer/topology-surface.test.ts`

**Interfaces:**
- Consumes: reconstructed density, voxel dimensions, physical cell size, and density isolation `0.32`.
- Produces: `buildTopologyDistanceField(density, dimensions, cellSize, densityIsolation): Float32Array`, normalized so its material boundary crosses `0.5`.
- `createTopologySurface` continues to return the same `THREE.Mesh` contract used by field coloring and replay deformation.

- [ ] **Step 1: Add failing distance-field tests**

```ts
it("preserves occupied cells and a protected internal void", () => {
  const density = new Float32Array(5 * 5 * 3).fill(1);
  density[index(2, 2, 1)] = 0;
  const before = Array.from(density);
  const field = buildTopologyDistanceField(
    density, { width: 5, height: 5, depth: 3 }, [2, 2, 1], 0.32,
  );
  expect(field[index(0, 0, 0)]).toBeGreaterThan(0.5);
  expect(field[index(2, 2, 1)]).toBeLessThan(0.5);
  expect(Array.from(density)).toEqual(before);
});

it("uses physical cell dimensions and is deterministic", () => {
  const first = buildTopologyDistanceField(density, dimensions, [2, 2, 1], 0.32);
  const second = buildTopologyDistanceField(density, dimensions, [2, 2, 1], 0.32);
  expect(Array.from(first)).toEqual(Array.from(second));
  expect(xNeighborFalloff(first)).toBeLessThan(zNeighborFalloff(first));
});
```

- [ ] **Step 2: Run the focused viewer tests and confirm they fail**

Run: `pnpm test:run src/viewer/topology-distance-field.test.ts src/viewer/topology-surface.test.ts`

Expected: FAIL because the distance-field module does not exist.

- [ ] **Step 3: Implement the anisotropic signed-distance field**

Use deterministic multi-source Dijkstra passes over the 26 voxel neighbors: one pass measures distance to material, the other distance to void. Neighbor weights are the Euclidean lengths formed from the physical `cellSize`. Normalize the signed distance with a blend radius of `2 * min(cellSize)`:

```ts
const signedDistance = distanceToVoid[index]! - distanceToMaterial[index]!;
field[index] = Math.max(0, Math.min(1,
  0.5 + signedDistance / (4 * Math.min(...cellSize)),
));
```

Reject mismatched/non-finite input and all-solid or all-void grids with explicit errors. Do not mutate `density`.

- [ ] **Step 4: Route Marching Cubes through the reconstructed scalar field**

In `topology-surface.ts`, replace Gaussian display smoothing with `buildTopologyDistanceField(...)`. Keep solver material classification at `0.32`, set the Marching Cubes display isolation to `0.5`, retain the current trilinear upsampling and cache, and set:

```ts
surface.userData.surfaceTreatment =
  "Density-derived signed-distance reconstruction; post-reconstruction solver field remains canonical";
```

- [ ] **Step 5: Verify the surface and integration build**

Run: `pnpm test:run src/viewer/topology-distance-field.test.ts src/viewer/topology-surface.test.ts src/viewer/FieldViewer.flight-replay.test.tsx`

Expected: PASS, including retained surface identity and replay deformation behavior.

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/viewer/topology-distance-field.ts src/viewer/topology-distance-field.test.ts src/viewer/topology-surface.ts src/viewer/topology-surface.test.ts
git commit -m "feat(viewer): render organic signed-distance topology"
```

