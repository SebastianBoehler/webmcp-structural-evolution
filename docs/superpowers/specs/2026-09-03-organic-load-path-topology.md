# Organic Load-Path Topology Design

## Outcome

The reference-drone optimizer produces a smooth, porous structural web with large open cells and blended, variable-thickness ribs. The geometry remains an interactive engineering estimate derived from the actual density solve, not a decorative lattice or a display-only substitute.

## Geometry chain

1. The existing SIMP-style solve produces a continuous density field from the authored design domain, load cases, required solids, protected/access voids, and must-pass load guides.
2. For live assembly studies with load-path guides, a deterministic reconstruction grows a face-connected web outward from required interfaces and must-pass paths. Growth preference comes from the solved density, so high-value material thickens before low-value material.
3. The reconstructed density replaces the pre-reconstruction density before compliance, displacement, stress, per-case vectors, material fraction, and safety factor are computed.
4. The viewer converts that reconstructed density into a signed-distance field and extracts its zero surface with Marching Cubes. This rounds voxel steps and blends junctions without inventing new occupied cells or filling protected voids.

## Solver requirements

- Reconstruction applies only when `load_path_guides` is non-empty; the legacy demo fixture remains unchanged.
- Every passive solid and every required path cell remains material.
- Every passive void remains exactly zero.
- Added material must be face-connected to the retained web.
- Growth is deterministic, uses the original solved density as its primary priority, and uses stable cell-index ordering for ties.
- Reconstructed material fraction must remain within one non-void cell of the preset target unless required seeds already exceed it.
- Structural and per-case fields must be recomputed after reconstruction.
- No new dependency is introduced.

## Viewer requirements

- The density threshold defining material remains `0.32`.
- The generated scalar display field crosses `0.5` at the reconstructed material boundary.
- Anisotropic cell dimensions are respected when computing distances.
- Input density is never mutated.
- Exact zero/protected cells remain outside the surface.
- The existing field-to-surface vertex mapping, replay displacement, stress coloring, and assembly transforms continue to consume the same grid and analysis fields.
- Surface metadata states that this is a density-derived signed-distance reconstruction.

## Product truth and acceptance

- The result remains labelled `interactive-estimate`, unverified, unaccepted, and subject to human review.
- Material, displacement, stress, safety factor, field colors, and replay deformation all correspond to the post-reconstruction density.
- The focused Rust topology tests, Wasm bridge tests, viewer surface tests, TypeScript build, and production build pass.
- Files should remain below the repository's 300 LOC soft limit; reconstruction and distance-field logic live in dedicated modules.

## Out of scope

- Repeating honeycomb, gyroid, or cosmetic lattice infill.
- B-rep/NURBS manufacturing reconstruction.
- Manufacturing or flight approval.
- Changing the authored design domain, loads, clearances, or the user-selected balanced preset.

