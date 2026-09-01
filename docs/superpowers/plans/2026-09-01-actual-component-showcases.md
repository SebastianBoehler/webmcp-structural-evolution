# Actual Component Showcase Integration Plan

**Goal:** Make every showcased structural/topology, mechanism, and thermal run
derive from an authoritative parametric component document instead of a generic
benchmark block, while retaining meshing and voxelization only as solver-internal
derived artifacts.

**Scope boundary:** These are engineering-grade parametric showcase models based
on catalog dimensions and assembly structure. They are not manufacturer STEP CAD
unless digest-verified STEP bytes are actually present and imported.

## Global constraints

- Reuse one solver-neutral `DesignDocument` compiler and exact OCCT artifact seam.
- Preserve the existing 52-part SE-6 assembly and reference-drone component data.
- Every derived mesh, voxel, field, replay, and topology artifact must carry
  lineage to the active document and exact component artifacts.
- No generic-geometry, saved-result, CPU, or fixture fallback in showcased routes.
- Keep modified production files below 300 LOC and avoid broad UI work.
- Run only focused component/compiler/gate tests, production build, and live route
  smoke checks.

## Task 1: Authoritative component documents

- Add explicit authority metadata for parametric specification models versus
  digest-verified STEP imports.
- Compile the reference-drone motor-side arm, SE-6 upper-arm housing, and full
  52-part SE-6 mechanism from existing catalogs/assembly placements into
  solver-neutral design documents.
- Map real supports, loads, materials, interfaces, stages, and joints from those
  sources. Remove copy that overstates sourced display assets as exact release CAD.

Success: each document rebuilds through OCCT; all component instances and named
interfaces resolve; no duplicated benchmark dimensions define showcased geometry.

## Task 2: Exact-source workspace planners

- Retain revision-bound BREP, semantic mesh, and body-dynamics artifacts as one
  validated exact component source per document revision.
- Provide production planners for structural, topology, mechanism, and thermal
  that consume that exact source through `EngineeringWorkspaceService`.
- Reuse the current voxelizers/adapters; do not reconstruct geometry inside a
  solver. Preserve stale-result, cancellation, lineage, and export fences.

Success: all four study kinds launch from exact artifact IDs tied to the active
component document, and mutations invalidate or quarantine stale derived work.

## Task 3: Showcase route switch and focused proof

- Switch structural/topology, mechanism, and thermal routes from generic authored
  benchmarks to the authoritative component-document planners.
- Keep analytical cubes/cantilevers only as internal regression fixtures.
- Show model ID, authority class, source revision, and component/body count without
  adding a broad new workbench UI.

Success: focused gate tests and production build pass; live WebGPU/Wasm runs show
  the actual parametric drone/SE-6 components with no fallback or console errors.
