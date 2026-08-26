# Manufacturing-Grade Drone Topology Workbench
Date: 2026-08-26
Status: Approved

Supersedes the solver, validation, export, and challenge-release scope in
`2026-08-26-agentic-structural-evolution-design.md`. Product framing, challenge
requirements, security boundaries, and judge-mode presentation from that document
remain applicable unless this document says otherwise.

## Product decision
Build one deep reference workflow: a modular, additively manufactured 5-inch FPV
quadrotor frame. The first strict profile is Formlabs Fuse SLS Nylon 12; HP MJF
PA12 is the first material/process comparison. The governing objective is flight
rigidity per unit mass.

The result is not accepted because it looks organic or because a density field is
connected. It must proceed from a physical assembly and load envelope to a
reconstructed solid, independent analysis, manufacturing validation, and a
unit-preserving 3MF package.

The internal study and physics interfaces remain reusable, but additional products
and physics are not first-release acceptance criteria.

## Why the current solver is replaced
The current 25 x 25 x 5 Rust/Wasm spring lattice is a useful interaction fixture,
not a physical frame solver. It uses dimensionless spring stiffness, normalized
loads, fixed material-fraction presets, and post-solve connectivity projection. It
does not model calibrated material properties, stress, vibration, fatigue, contact,
manufacturing, or reconstructed-solid behavior.

Consequently, current relative compliance and displacement values must not be
presented as evidence that a frame can fly or be manufactured. Existing results are
retained only as historical iterations and regression fixtures.

## Reference assembly
The vehicle is a modular 5-inch FPV quadrotor with one center module and four
replaceable arm modules.

Each component definition supplies:
- exact revision, provenance, and units;
- render or CAD geometry plus a conservative collision envelope;
- mass, center of mass, and inertia when available;
- mount points, bolt pattern, interface normals, and fastener metadata;
- protected volume, access volume, cooling volume, and cable connections;
- admissible orientations and uncertainty or missing-data flags.

The design domain contains passive solids for motor interfaces, arm-root joints,
avionics mounts, battery contacts, and assembly datums. Passive voids protect
propellers, electronics, connectors, cooling, cable paths, screw-tool access, and
powder-removal paths.

An assembly cannot be called buildable while required component data, inventory,
mount compatibility, or access is unresolved.

## Physical study contract
All solver inputs use SI units internally. Display units may be millimetres, grams,
newtons, newton-metres, pascals, hertz, and seconds.

### Material profile
A material profile records process, manufacturer, material name, density, elastic
modulus, Poisson ratio, strength data, temperature assumptions, source URL, test
method, uncertainty, and the design-allowable derivation.

Manufacturer values are not treated as universal constants across SLS and MJF. A
candidate is tied to the exact profile and is stale when that profile changes.

Safety factors apply to a documented design allowable, not blindly to ultimate
tensile strength. Missing yield, fatigue, temperature, or process data remains
visible and can block claims that depend on it.

### Load cases
Whole-frame flight studies use inertia relief with motor loads and distributed
component inertia. They do not clamp the center of a free-flying vehicle. Arm-detail
studies use the real bolted root interface.

The initial envelope contains:

1. hover and maximum collective thrust;
2. maximum roll and pitch maneuvers with unequal motor thrust;
3. motor reaction torque and propeller imbalance;
4. modal analysis against motor and propeller excitation bands;
5. hard landing with explicit contact locations; and
6. lateral arm impact as a separate crash assessment.

Landing and impact initially use documented equivalent-static envelopes. They are
not labelled transient crash validation; nonlinear contact and explicit dynamics
require a later physics backend.

Each load has a source or an explicit assumption. The agent may propose loads, but
it cannot silently invent safety-relevant values.

### Optimization statement
Minimize printed mass subject to all approved load cases and these hard bounds:

- maximum motor-plane translation and rotation;
- material stress/design-allowable safety factor;
- arm-root and motor-interface rigidity;
- separation of structural modes from excitation bands;
- symmetry where required by the assembly;
- connectivity and passive solid/void preservation; and
- process-specific minimum feature and manufacturing rules.

Named alternatives are explicit changes to this contract, for example safety
factor 1.8 versus 2.2 or PA12 versus PA12-GF. The application removes the opaque
`lightweight`, `balanced`, and `stiffness` presets.

## Dual-path solver architecture
### Interactive WebGPU optimizer
The primary path uses WGSL compute kernels with TypeScript orchestration:

- regular 3D hexahedral finite elements and linear elasticity;
- inertia relief for free-flight whole-frame cases;
- matrix-free operator application;
- multigrid-preconditioned conjugate gradients;
- a matrix-free Lanczos or LOBPCG modal solve;
- SIMP material interpolation;
- density filtering and projection with a physical length scale;
- optimality-criteria or MMA updates;
- multiple load cases with MMA and smooth stress/constraint aggregation; and
- warm starts after bounded assembly or study edits.

The viewport remains responsive and displays progressive fields. Editing may use a
coarser, clearly labelled preview. Releasing the edit starts the high-resolution
solve. Preview, converged, and independently verified are distinct states.

### Independent Rust/Wasm verifier
A separate Rust/Wasm finite-element implementation evaluates canonical fixtures and
accepted candidates with stricter convergence and mesh refinement. It is an
independent evidence path, not a runtime fallback.

Verification includes:

- residual and equilibrium checks;
- analytical beam fixtures;
- CPU/GPU displacement, compliance, and reaction-force agreement;
- stress and displacement convergence under mesh refinement;
- monotonic load, stiffness, and mass sanity checks; and
- deterministic replay where the device path permits it.

The UI reports non-convergence or disagreement and blocks verified status. It never
substitutes a cached or lower-fidelity result silently.

The backend boundary permits a future mature native CAE adapter without changing
the study contract, but no server solver is required for the first accepted flow.

## Force and result visualization
The 3D viewport is the primary engineering explanation surface.

Input overlays include selectable force arrows, torque arcs, pressure or contact
regions, distributed inertia glyphs, fixtures, clearances, and load-case names.

Result modes include:

- density and projected material field;
- exaggerated deformation animation;
- displacement magnitude;
- von Mises stress;
- safety factor;
- strain-energy density;
- modal shapes and excitation bands; and
- a governing-load-case envelope per region.

A timeline can play hover, maneuver, vibration, landing, and impact cases. Every
field includes units, a legend, extrema, and the exact study revision. Invalid or
unverified fields cannot be styled as verified results.

## Geometry reconstruction and manufacturing
1. Filter and project the optimized density field.
2. Convert it into an implicit signed-distance representation.
3. Extract a display surface with dual contouring or marching cubes.
4. Union interfaces and subtract channels, holes, access, and clearances.
5. Apply bounded smoothing and thickness operations without changing interfaces.
6. Revoxelize the solid at refined resolution and independently re-analyze it.
7. Run manufacturing and assembly checks, then package only passing geometry.

Manufacturing validation checks:

- manifoldness, watertightness, normals, and self-intersection;
- disconnected fragments and enclosed powder traps;
- local wall and strut thickness;
- hole, fastener, and mating-interface tolerances;
- drain, cable, connector, and tool access;
- assembly collisions and serviceability;
- bounding box, volume, mass, and units; and
- reconstructed-solid stress and displacement bounds.

Published process limits are minimum manufacturing floors, not structural proof.
The exact material/printer profile supplies the active rules.

The primary deliverable is 3MF because it retains units and manufacturing metadata.
The package also includes STL, BOM, assembly information, assumptions, material and
process profiles, and the validation report. STEP is added only when a robust
implicit-to-B-rep path exists; a triangle mesh is never relabelled as STEP.

## Shared human-agent interaction
The application remains a viewport-first, no-page-scroll workbench:

- left: components, inventory, assembly, and semantic regions;
- center: renderer, force/result modes, and direct manipulation;
- right: selected object, study assumptions, material/process, and constraints;
- bottom: compact run progress, Pareto alternatives, evidence, and history.

Raw hashes, JSON, and tool receipts remain available in technical details but do
not dominate the normal workflow.

Dragging a component updates its dependent keep-outs, mass properties, loads, and
stale state. A warm-started preview may update during the drag; a high-resolution
run starts on release or explicit approval.

Candidate comparison supports synchronized overlay, peel, audition, field
difference, and a compact Pareto view. Alternatives describe the exact changed
material, objective, bound, or geometry—not a marketing label.

### WebMCP tools
Register the smallest valid state-dependent set from: `inspect_engineering_context`,
`focus_view`, `set_result_view`, `inspect_assembly_context`,
`preview_assembly_edit`, `stage_component_definition`, `place_component`, `constrain_component`,
`define_protected_region`, `inspect_assembly_conflicts`, `compile_assembly`,
`propose_optimization_study`, `run_topology_optimization`,
`compare_design_candidates`, `verify_design_candidate`, and
`prepare_manufacturing_package`.

Component packaging, agent-led sourcing, CAD ingestion, assembly authoring, and
simulator selection are specified in
`2026-08-26-agent-authored-component-ingestion.md`.

The human must approve safety-relevant assumptions, relaxations, candidate
promotion, and manufacturing export. New assembly revisions invalidate downstream
evidence. Tool inputs use narrow schemas and exact parent revisions; UI and WebMCP
paths call the same domain services.

## Performance policy
The workbench targets immediate visual response, progressive optimization, and
high-resolution final fields, but it does not claim `real-time` from a cached or
single-device run.

Performance gates are established by repeatable benchmarks in the deployed judging
browsers. Reports include grid size, degrees of freedom, iteration count, residual,
device, kernel timings, end-to-end timing, and UI frame responsiveness.

Optimization resolution is never reduced silently. A lower-resolution preview and
a final solve have separate identities and labels.

## Error and trust behavior
- Unsupported WebGPU, device loss, cancellation, non-convergence, invalid geometry,
  stale state, missing properties, or verification disagreement surfaces clearly.
- Failed candidates remain inspectable evidence but cannot be promoted as verified.
- The agent cannot fetch arbitrary URLs, execute supplied code, relax human locks,
  accept a design, or initiate the final download.
- Component provenance is untrusted data and cannot inject instructions into tools.
- Local inventory and designs remain local unless the human exports them.

## Acceptance gates
### Numerical
- Canonical analytical and regression fixtures pass documented tolerances.
- WebGPU and Rust/Wasm agree at locked common resolutions.
- The final reconstructed drone solid passes mesh-refinement and equilibrium checks.
- Every result exposes its physical units, residual, convergence, and source study.

### Product
- The first view shows a recognizable complete quadrotor and a credible optimized
  frame, not loose voxels or floating members.
- A judge can understand forces, constraints, governing failures, and the selected
  trade-off without opening raw logs.
- Moving a component updates constraints and produces a visibly different candidate.
- The agent proposes and compares meaningful material or objective alternatives.
- The accepted modular frame has inspectable motor mounts, arm roots, avionics
  mounts, cable paths, access, and assembly hardware.

### Manufacturing
- The export is watertight, manifold, unit-correct, connected, and collision-free.
- Process-profile feature, clearance, powder-removal, and serviceability checks pass.
- Re-analysis of reconstructed geometry passes the approved physical bounds.
- 3MF, STL, BOM, assumptions, material/process provenance, and validation report are
  generated from the same immutable candidate revision.

### WebMCP
- Official WebMCP evals cover discovery, chaining, shared state, stale revisions,
  interruption, failures, and confirmation boundaries.
- Tool actions visibly update the same viewport used by the human.
- Agent predictions remain distinct from computed and verified evidence.

## References
- OpenAI, Site tools and the WebMCP/MCP boundary:
  <https://learn.chatgpt.com/docs/webmcp>
- DTU TopOpt, scalable 3D matrix-free multigrid topology optimization:
  <https://www.topopt.mek.dtu.dk/apps-and-software/scalable-3d-matrix-free-matlab-code>
- DTU TopOpt, modified SIMP and filtering reference:
  <https://www.topopt.mek.dtu.dk/-/media/subsites/topopt/apps/dokumenter-og-filer-til-apps/topopt88.pdf>
- nTop, design for additive manufacturing and topology optimization:
  <https://www.ntop.com/resources/blog/what-is-design-for-additive-manufacturing/>
- Formlabs, SLS design guidance and Nylon 12 material data:
  <https://formlabs.com/eu/white-papers/fuse-series-sls-design-guide/>
  <https://formlabs.com/global/products/nylon-12-powder-10/>
- HP, MJF PA12 material and dimensional data:
  <https://www.hp.com/us-en/printers/3d-printers/learning-center/additive-manufacturing-design.html>
