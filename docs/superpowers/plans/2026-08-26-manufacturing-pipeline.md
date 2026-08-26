# Manufacturing Geometry and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert a converged physical density field into a connected, independently re-verified, process-aware body that can be manufactured from a unit-preserving 3MF package.

**Architecture:** A bounded geometry pipeline reconstructs an implicit surface, unions preserved mounts and subtracts protected voids, smooths within a deviation budget, revoxelizes the final mesh, and sends it back through the independent verifier. Process rules and exporters consume only this checked manufacturing candidate.

**Tech Stack:** TypeScript 7, Three.js 0.185, three-mesh-bvh 0.9.14, three-bvh-csg 0.0.18, fflate 0.8.3, Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-manufacturing-grade-drone-topology-design.md`

## Global Constraints
- Complete the physical optimizer plan first.
- 3MF is the primary deliverable; STL is compatibility-only and carries an explicit unit warning.
- Preserve mounts, inserts, cable corridors, connector access, assembly clearance, and rotor/component keep-outs exactly.
- Reject disconnected, non-manifold, self-intersecting, under-thickness, trapped-powder, or verification-failing outputs.
- Do not claim certification merely because a solver or mesh check passed.
- Keep every source file at or below 300 LOC.

---

### Task 1: Reconstruct a watertight implicit surface

**Files:**
- Create: `src/manufacturing/scalar-field.ts`
- Create: `src/manufacturing/surface-extraction.ts`
- Create: `src/manufacturing/mesh-topology.ts`
- Test: `src/manufacturing/surface-extraction.test.ts`

**Interfaces:**
- Produces: `reconstructSurface(field, isoValue)`, `inspectMeshTopology(mesh)`.

- [ ] **Step 1: Write failing sphere, bridge, and disconnected-island tests**

Assert closed edge incidence, consistent winding, bounded Hausdorff error, and explicit island reporting.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/manufacturing/surface-extraction.test.ts`

Expected: FAIL because reconstruction is absent.

- [ ] **Step 3: Implement indexed marching cubes with asymptotic ambiguity handling**

Deduplicate edge vertices, orient triangles from density gradients, remove degenerate faces, retain island labels, and never silently delete disconnected material.

- [ ] **Step 4: Run reconstruction tests**

Run: `pnpm vitest run src/manufacturing/surface-extraction.test.ts`

Expected: PASS for analytical and locked topology fixtures.

- [ ] **Step 5: Commit**

```bash
git add src/manufacturing
git commit -m "feat(manufacturing): reconstruct watertight topology surfaces"
```

### Task 2: Preserve interfaces and protected voids

**Files:**
- Create: `src/manufacturing/interface-geometry.ts`
- Create: `src/manufacturing/boolean-pipeline.ts`
- Create: `src/manufacturing/smoothing.ts`
- Test: `src/manufacturing/boolean-pipeline.test.ts`

**Interfaces:**
- Produces: `buildInterfaceSolids()`, `applyProtectedGeometry()`, `smoothWithinBudget()`.

- [ ] **Step 1: Write failing motor-mount, insert, cable, and clearance tests**

Assert bolt holes remain open, motor rings intersect the load path, cables remain routable, and smoothing stays outside immutable regions.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/manufacturing/boolean-pipeline.test.ts`

Expected: FAIL because interface booleans do not exist.

- [ ] **Step 3: Verify pinned geometry dependencies and implement deterministic CSG**

Run: `pnpm list fflate three-mesh-bvh three-bvh-csg`

Expected: `fflate@0.8.3`, `three-mesh-bvh@0.9.14`, and `three-bvh-csg@0.0.18`
from the component-ingestion plan.

Union structural interfaces first, subtract protected voids second, then smooth only mutable surface vertices. Return structured failure details for non-manifold CSG results.

- [ ] **Step 4: Run interface tests**

Run: `pnpm vitest run src/manufacturing/boolean-pipeline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/manufacturing
git commit -m "feat(manufacturing): preserve mounts and protected voids"
```

### Task 3: Revoxelize and independently re-verify final geometry

**Files:**
- Create: `src/manufacturing/revoxelize.ts`
- Create: `src/manufacturing/final-verification.ts`
- Test: `src/manufacturing/final-verification.test.ts`

**Interfaces:**
- Produces: `revoxelizeMesh()`, `verifyManufacturingCandidate()`.

- [ ] **Step 1: Write failing deviation and governing-load tests**

Verify the extracted mesh changes the analysis input, all six cases run again, and a post-processing safety-factor regression blocks release.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/manufacturing/final-verification.test.ts`

Expected: FAIL because final-mesh verification is absent.

- [ ] **Step 3: Implement conservative voxel occupancy and Wasm verification**

Record density-to-mesh deviation, mesh-to-revoxel deviation, solver residuals, governing load case, displacement, rotation, stress, safety factor, and modes. `verified` requires every locked tolerance and hard bound to pass.

- [ ] **Step 4: Run final verification tests**

Run: `pnpm wasm:build && pnpm vitest run src/manufacturing/final-verification.test.ts`

Expected: PASS for valid fixture and explicit rejection fixtures.

- [ ] **Step 5: Commit**

```bash
git add src/manufacturing
git commit -m "feat(manufacturing): reverify extracted geometry"
```

### Task 4: Enforce SLS and MJF manufacturing rules

**Files:**
- Create: `src/manufacturing/process-profile.ts`
- Create: `src/manufacturing/process-validation.ts`
- Create: `src/manufacturing/profiles/formlabs-fuse-pa12.ts`
- Create: `src/manufacturing/profiles/hp-mjf-pa12.ts`
- Test: `src/manufacturing/process-validation.test.ts`

**Interfaces:**
- Produces: `ManufacturingProcessProfile`, `validateForProcess()`.

- [ ] **Step 1: Write failing wall, hole, escape, clearance, and evidence tests**

Use the exact sourced Formlabs profile as the release gate and HP MJF PA12 as a distinct comparison; prove values cannot be mixed across profiles.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/manufacturing/process-validation.test.ts`

Expected: FAIL because process validation is absent.

- [ ] **Step 3: Implement source-bound rules and geometric measurements**

Every limit stores source URL, revision/access date, applicability, and unit. Report measured minimum wall, hole diameter, trapped volumes, clearance, bounding box, and machine envelope.

- [ ] **Step 4: Run process tests**

Run: `pnpm vitest run src/manufacturing/process-validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/manufacturing
git commit -m "feat(manufacturing): validate pa12 process constraints"
```

### Task 5: Export a traceable manufacturing package

**Files:**
- Create: `src/export/three-mf.ts`
- Create: `src/export/stl.ts`
- Create: `src/export/manufacturing-package.ts`
- Create: `src/export/validation-report.ts`
- Test: `src/export/manufacturing-package.test.ts`

**Interfaces:**
- Produces: `buildManufacturingPackage(candidate) -> Blob` containing 3MF, STL, BOM, assumptions, sources, hashes, and validation report.

- [ ] **Step 1: Write failing archive, unit, lineage, and rejection tests**

Assert the 3MF declares millimetres, all files are hashed, revision lineage is present, and unverified candidates cannot export.

- [ ] **Step 2: Verify failure**

Run: `pnpm vitest run src/export/manufacturing-package.test.ts`

Expected: FAIL because exporters are absent.

- [ ] **Step 3: Implement deterministic 3MF/XML, STL, BOM, and report generation**

Keep human approval outside WebMCP execution. Export filenames include the candidate revision and process profile; STL documentation states its unit ambiguity.

- [ ] **Step 4: Run export and full checks**

Run: `pnpm vitest run src/export && pnpm check`

Expected: PASS; unzip inspection shows valid deterministic package contents.

- [ ] **Step 5: Commit**

```bash
git add src/export
git commit -m "feat(export): package verified manufacturing geometry"
```
