# FPV topology core handoff

## Goal

Prove one complete, buildable FPV-drone workflow before expanding the product: real purchasable components and CAD, agent-authored interfaces/keep-outs, assembly-derived topology optimization, physical simulation, visible force results, and printable export.

## Works now

- React/Three.js CAD workbench with selectable and movable motors, propellers, FC/ESC stack, battery, wiring corridors, mount hardware, grid, axes, and light/dark modes.
- Browser import of real STEP files was verified for a Holybro 2216 motor, 1045 propeller, flight-controller board, and 4S LiPo. OCCT tessellated them successfully in the app.
- Deterministic Rust/Wasm density optimizer runs four hover/agility/torsion load cases and returns a connected frame.
- The reference solve preserves motor plates, removes motor/body, FC/ESC, battery, and cable volumes, and the reconstructed surface includes sixteen M3 motor-clearance holes.
- The browser exports the exact displayed surface. The latest STL had 18,608 triangles, one connected component, zero boundary edges, and zero non-manifold edges.
- `main` at `667e96f`; focused STL/conflict tests, Wasm build, TypeScript build, and live Browser generation/export passed.

## Does not work yet

- Imported CAD becomes a generic 1 g mesh with no inferred category, mass, interfaces, mounts, keep-outs, provenance, or replacement of an existing assembly instance.
- The four test STEP assets are not committed because their redistribution terms were not all cleanly established.
- Optimization input is still a hard-coded 25 x 25 x 5 reference grid. Current assembly edits/imports mark evidence stale but cannot regenerate solver geometry from the changed assembly.
- The smoother organic surface is a faithful interpolation of a coarse density field; the underlying optimization is still coarse and constrained to a cross-shaped domain.
- Displacement is solver-normalized rather than calibrated physical FEA. Stress, safety factor, bending animation, thermal simulation, heat flow, and force overlays are absent.
- The app still reports 14 reference-assembly conflicts. WebMCP tools exist, but the full agent prompt -> source/import -> annotate -> arrange -> optimize -> simulate -> export loop has not been demonstrated.

## Must improve next

1. Freeze one buildable 5-inch FPV reference BOM with orderable part numbers and clearly redistributable CAD or repo-owned parametric models.
2. Make imports become typed components. Let the agent supply/confirm dimensions, mass, mount interfaces, fastener/tool clearances, protected volumes, material, source, and confidence.
3. Generate the optimization domain, passive solids/voids, loads, and boundary conditions from the live assembly revision. Remove the hard-coded reference grid.
4. Increase the actual solver resolution and use physically calibrated elasticity/material units. Preserve component clearances and printable minimum features at solver/export resolution.
5. Add structural result modes first: loads/supports, displacement/deformed shape, stress and safety factor. Add thermal results for ESC, motors, and battery only after structural results are credible.
6. Verify one visible WebMCP run end to end and record timings, topology/FEA metrics, export manifold checks, and a buildable BOM.

## Work differently

- Stay on this vertical slice; defer other objects, broad UI polish, hardening, and generalized infrastructure.
- Do not launch reviewer/sub-agent loops unless explicitly requested.
- Prefer one implementation pass plus one focused test and one Browser proof per milestone.
- Do not claim physical validity from a smooth render. Gate progress on assembly-derived inputs, calibrated outputs, and exported-geometry checks.
