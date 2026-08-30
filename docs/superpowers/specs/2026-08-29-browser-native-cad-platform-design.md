# Browser-Native Mechanical CAD Platform Design

**Status:** Approved architecture; September engineering-alpha scope approved
**Date:** 2026-08-29  
**First benchmark:** Editable rocket turbopump assembly

## Objective

Structural Evolution becomes a general browser-native mechanical design and engineering workbench. A human and an agent operate on the same exact, editable design document. The product combines parametric CAD, assemblies, mechanism physics, topology and generative geometry, FEA, CFD, thermal analysis, additive-manufacturing preparation, rendering, revision control, and WebMCP collaboration.

The long-term benchmark is functional parity with serious desktop CAD and modeling workflows, not visual imitation. Parity is reached subsystem by subsystem through explicit acceptance suites. AI accelerates implementation and iteration, but does not replace geometric robustness, numerical verification, interoperability testing, or experimental validation.

The application must be browser-runnable. This does not require every algorithm to execute as a WebGPU shader. The browser runtime may combine WebGPU, multithreaded Wasm, and optional remote workers while presenting one coherent local-first application.

## Product boundaries

The first authoritative modeling behavior is mechanical parametric CAD:

- constrained sketches and named dimensions;
- exact solid features and ordered rebuild history;
- reusable components and multi-level assemblies;
- mates, joints, contacts, collision, and clearance;
- stable semantic selection of bodies, features, faces, edges, and interfaces;
- STEP import/export and derived visualization/manufacturing formats;
- explicit units, coordinate systems, materials, provenance, and revision history.

Freeform mesh and subdivision modeling remain compatible future body types, but they do not weaken the exact-solid contract or enter the first CAD-core milestone.

The first milestone is deliberately a complex machine assembly rather than a tutorial bracket. The turbopump is decomposed into independently valid subassemblies so visual density cannot hide invalid geometry.

## Architectural principles

1. One authoritative design document owns intent and semantics.
2. Exact B-rep geometry owns mechanical solids and interfaces.
3. Implicit fields own topology, lattices, offsets, supports, and field-driven geometry.
4. Meshes, solver grids, renders, and toolpaths are derived revision-keyed artifacts.
5. Human gestures and agent actions use the same typed command transactions.
6. No renderer object, fixture identifier, or solver preset may become design state.
7. Every boundary condition and manufacturing rule attaches to persistent semantic references.
8. Local and remote execution use the same job and result contracts.
9. Interactive estimates, converged solves, and validated results are never conflated.
10. Complex assemblies are composed from independently testable subsystems.

## Authoritative `DesignDocument`

`DesignDocument` is immutable and content-addressed. It contains:

- document units, world frames, and component-local frames;
- named scalar, vector, material, and configuration parameters;
- sketches, planes, entities, dimensions, and constraint systems;
- ordered features and their typed inputs;
- exact bodies and persistent body/feature/interface identities;
- component definitions, assembly instances, transforms, mates, joints, and contacts;
- materials, mass accounting, manufacturing processes, and tolerances;
- named selections for supports, loads, fluids, thermal boundaries, protected regions, service corridors, and build constraints;
- load cases, objectives, constraints, solver studies, and acceptance policies;
- provenance and qualified-assumption records;
- accepted, staged, and compared revision relationships.

A drone, cobot, turbopump, vehicle, aircraft, furniture assembly, or robot is a document or template. None receives a privileged runtime path.

## Transaction model

Every edit is a typed transaction:

```text
expected revision
+ commands
+ preconditions
→ rebuild
→ validate
→ new revision or structured failure
```

Representative commands include:

- `create_sketch`, `set_sketch_constraint`, and `set_parameter`;
- `extrude_profile`, `revolve_profile`, `sweep_profile`, and `loft_profiles`;
- `boolean_union`, `boolean_cut`, and `boolean_intersect`;
- `fillet_edges`, `chamfer_edges`, `create_hole`, and `circular_pattern`;
- `create_component`, `place_instance`, `mate_interfaces`, and `create_joint`;
- `define_material`, `define_contact`, `attach_load_case`, and `define_rotating_region`;
- `define_topology_domain`, `define_protected_region`, and `define_manufacturing_constraint`.

Transactions are deterministic for identical inputs and reject stale parent revisions. Direct manipulation produces preview commands; it never mutates meshes directly. Successful transactions generate undo/redo history, branchable revisions, receipts, invalidation events, and provenance records.

## Geometry representation

### Parametric feature graph

The feature graph owns design intent and rebuild order. Feature inputs reference parameters, sketches, earlier bodies, and persistent semantic selections. A rebuild either produces an exact result or a diagnostic; it never substitutes a proxy body.

### Exact B-rep

The initial exact kernel is a full OCCT modeling build compiled to Wasm behind `CadKernelAdapter`. The current STEP tessellation importer is not the editing kernel. Kernel objects remain opaque inside a dedicated worker.

The adapter exposes:

- sketch-plane and wire construction;
- exact feature operations and booleans;
- fillets, chamfers, holes, patterns, sweeps, and lofts;
- body validity, mass properties, distances, intersections, and section curves;
- STEP read/write;
- controlled tessellation with face and edge ownership.

### Persistent topology naming

Faces and edges are tracked using feature lineage plus geometric signatures and adjacency. If an edit makes a reference ambiguous, evaluation returns `reference-requires-repair` with the affected feature and consumers. It must never silently move a mate, load, fluid boundary, or manufacturing constraint to another face.

### Implicit and SDF graph

The implicit graph owns topology-density fields, lattices, smooth blends, offsets, clearance fields, additive supports, and field-driven thickness. B-rep bodies may seed fields, and accepted fields may be converted into manufacturing bodies, but neither representation silently replaces the other's ownership.

### Derived meshes

Render meshes, collision meshes, FEA/CFD meshes, additive meshes, STL, 3MF, and glTF are revision-keyed artifacts. Each records source revision, settings, generator version, units, tolerances, and hashes.

## Runtime decomposition

### CAD worker

A multithreaded Wasm worker evaluates sketches and features, owns B-rep handles, validates geometry, computes mass properties, performs STEP exchange, and emits compact semantic tessellations. Evaluation is cancellable and reports feature-level progress and errors.

### WebGPU viewport

The viewport provides PBR rendering, semantic picking, outlines, measurements, clipping planes, exploded views, section views, transform manipulators, large field overlays, and agent-visible render capture. Selection IDs preserve the hierarchy from assembly through face and edge.

The existing WebGL renderer may remain during migration, but the target renderer and field pipeline use WebGPU. Renderer migration cannot change the document contract.

### Mechanism and collision worker

Assembly bodies and mates compile into rigid bodies, joints, contacts, collision shapes, and constraints. The worker supports deterministic stepping, collision and minimum-clearance queries, joint limits, fixtures, gravity, and applied forces. Collision approximations remain traceable to their source bodies and tolerances.

### Field-compute layer

WebGPU is preferred for parallel SDF construction, voxelization, distance fields, topology iterations, lattice fields, support/overhang fields, field visualization, reduced-order inference, and suitable solver pre/post-processing. Device capabilities, precision, memory use, and determinism are recorded with results.

### Solver workers

FEA, CFD, thermal, modal, buckling, fatigue, and coupled analyses implement one `SolverAdapter` protocol. An adapter declares:

- supported disciplines and analysis types;
- accepted geometry and mesh artifacts;
- material and boundary-condition schemas;
- precision and hardware requirements;
- progress, checkpoint, cancellation, and failure behavior;
- convergence, residual, conservation, and validation evidence;
- output fields, scalar metrics, and uncertainty metadata.

Adapters may execute in WebGPU, Wasm CPU workers, or remote containers. Execution location does not alter study identity or result semantics.

## Manufacturing pipeline

The manufacturing pipeline consumes accepted exact or implicit bodies and produces traceable derived artifacts:

1. validate body closure, orientation, units, and minimum features;
2. generate a watertight manufacturing mesh at an explicit tolerance;
3. select build process, machine, material, orientation, and stock/build volume;
4. evaluate wall thickness, overhang, trapped volumes, access, clearance, and support requirements;
5. generate supports or process-specific fixtures as separate semantic bodies;
6. slice into layers and toolpaths;
7. emit 3MF and machine-specific output with settings and provenance.

Topology objectives may incorporate manufacturability, but slicing does not retroactively redefine design intent. Manufacturing feedback enters the document through explicit constraints and new revisions.

## Human and agent interaction

The workbench presents one semantic hierarchy:

```text
project
└── assembly
    └── component instance
        └── body
            └── feature
                └── sketch / face / edge / interface
```

The assembly and feature history share the left workspace. The viewport occupies the center. The inspector edits parameters, constraints, materials, interfaces, joints, studies, and manufacturing rules. Physics and Manufacturing are modes over the same document, not separate applications.

The agent uses WebMCP resources and tools to:

- inspect the document, selection, parameters, interfaces, studies, jobs, and evidence;
- propose transactions and request dry-run rebuilds;
- inspect diagnostics, measurements, renders, and comparison branches;
- request approval for a revision;
- launch, monitor, cancel, and inspect solver/manufacturing jobs;
- compare alternatives and recommend acceptance with cited evidence.

The human can select and manipulate geometry while an agent operates. Expected revisions prevent silent overwrites. Concurrent changes create explicit branches or rebase requests. Destructive imports, revision acceptance, manufacturing export, and claims above interactive-estimate level require visible approval.

## Errors and progressive states

The platform exposes typed failures including:

- under- or over-constrained sketch;
- failed or non-manifold boolean;
- invalid solid or open shell;
- missing or ambiguous persistent reference;
- unresolved or cyclic mate;
- collision, insufficient clearance, or joint-limit violation;
- non-watertight manufacturing body;
- unavailable WebGPU capability or exceeded browser memory budget;
- solver divergence, failed conservation, unconverged mesh, timeout, or cancellation.

Jobs use `queued`, `running`, `partial`, `verified`, `failed`, and `cancelled` states. Partial results are viewable but cannot satisfy verification gates.

## Deployment architecture

Vercel remains sufficient for the application shell, static Wasm/kernel assets, WebGPU runtime, local documents, and bounded API operations.

Persistent multi-device projects add:

- object storage for documents and derived artifacts;
- PostgreSQL for project metadata, revisions, permissions, job records, and provenance;
- a durable queue for solver, conversion, and slicing jobs;
- containerized workers with pinned images and resource limits;
- WebSocket or equivalent collaboration transport for presence and revision events.

Long-running or memory-intensive solvers do not run inside ordinary request functions. Local-first documents remain usable without the backend; unavailable remote capabilities fail explicitly.

## September 4 engineering alpha

The deadline deliverable is a coherent engineering alpha, not desktop-CAD parity
and not a collection of decorative solver panels. CAD, simulation, optimization,
and agent actions operate on the same revisioned design document and semantic
selections. The UI does not designate one physics discipline as primary.

The browser runtime combines WebGPU with Wasm workers deliberately:

- WebGPU owns the target viewport, field visualization, parallel numerical
  operators, and topology iterations suited to GPU execution;
- the exact B-rep kernel runs as OCCT-backed Wasm in a dedicated worker;
- deterministic CPU/Wasm references check bounded GPU numerical paths;
- every unavailable capability fails visibly instead of substituting a mesh,
  cached result, or synthetic response.

The alpha exposes three real solver tools through one `SolverAdapter` and job
contract:

1. **Structural and topology:** bounded linear-static elasticity with explicit
   materials, supports, and loads; displacement, compliance, balance, and stress
   outputs; topology iterations and post-extraction re-analysis.
2. **Mechanism dynamics:** deterministic rigid bodies, mates, joints, limits,
   collision, clearance, gravity, and applied-force stepping for assemblies.
3. **Steady-state thermal:** bounded conduction with explicit material
   conductivity, temperature and heat-flux boundaries, energy-balance evidence,
   and temperature-field output.

Each adapter declares the geometry classes, material model, boundary conditions,
precision, hardware, and problem size it supports. A valid study outside that
envelope is reported as unsupported. The alpha does not claim nonlinear FEA,
transient thermal analysis, CFD, contact FEA, fatigue life, or experimentally
validated predictions.

The human and agent share a hybrid authoring surface. The minimum exact-CAD path
supports constrained 2D profiles, named dimensions, extrude, revolve, boolean
union/cut/intersection, ordered rebuild history, component placement, rigid mates,
and STEP import/export. Direct manipulation and WebMCP tools produce the same
typed transactions, diagnostics, undo/redo history, and artifact invalidations.

The deadline acceptance journey must demonstrate all of the following without a
fixture-specific runtime branch:

1. Author and parameter-edit an exact mechanical component, then rebuild and
   preserve valid semantic references.
2. Place the component in an assembly and exercise a joint with collision and
   clearance feedback.
3. Attach structural and thermal studies to named selections, run both, and
   inspect truth-labelled fields and evidence.
4. Run topology optimization from the structural study, generate and export a
   manufacturable body, and re-analyze the accepted result.
5. Perform the same inspect, edit, launch, cancel, compare, and export operations
   through visible UI controls and WebMCP tools.
6. Complete a live browser pass with real WebGPU capability, worker execution,
   no console errors, and no hidden saved-result or CPU fallback.

The existing drone, cobot/link, and fixture examples are benchmark documents,
not privileged product modes. The alpha is considered general only when the same
document, transaction, solver, and artifact contracts serve more than one of
those geometries.

## Turbopump benchmark

The benchmark assembly includes independently valid subassemblies for:

- shaft, impeller, and couplings;
- bearing cartridge and retainers;
- volute/casing and chamber interfaces;
- seals and clearances;
- inlet/outlet plumbing and flanges;
- fasteners, brackets, and support frame.

The first CAD-core milestone passes only when it demonstrates:

1. At least 25 placed instances and 10 feature-authored component classes.
2. Sketch, revolve, extrude, sweep, boolean, fillet/chamfer, hole, and circular-pattern features.
3. Parameter edits that rebuild exact bodies, semantic meshes, mass properties, collisions, and dependent artifacts.
4. Rigid mates and a rotating shaft joint.
5. Clearance/contact detection, including a deliberately introduced and repaired collision.
6. STEP import, STEP export, and glTF export with correct units and semantic ownership.
7. One topology-optimized support attached to persistent named interfaces.
8. Additive orientation, overhang/support analysis, and slicing for the optimized support.
9. Agent prompt to dry-run, render inspection, correction, and human approval.
10. No fixture-specific geometry or solver branches and no browser-console errors.

The turbopump demonstrates workflow integration before it claims validated turbomachinery performance.

## Truth and validation policy

Every result carries one truth level:

- **Interactive estimate:** fast, bounded approximation for design feedback.
- **Calibrated surrogate:** approximation validated within a documented domain.
- **Converged numerical solve:** residual, conservation, mesh, and solver gates passed.
- **Experimentally validated:** numerical result agrees with qualified physical evidence inside stated uncertainty.

Acceptance suites include:

- sketch and constraint-system benchmarks;
- B-rep operation regressions and property-based geometry cases;
- persistent-reference edit sequences;
- geometric validity, STEP round trips, units, and tolerance checks;
- collision and mechanism benchmarks;
- FEA analytical problems, mesh convergence, and cross-solver comparisons;
- CFD conservation, residual, canonical-flow, and mesh studies;
- thermal and coupled-energy balance checks;
- slicing geometry, layer, support, and machine-envelope checks;
- deterministic revision, artifact, cancellation, and memory tests;
- human-agent task completion and provenance completeness;
- live browser and WebMCP end-to-end proof.

Passing application tests never upgrades an engineering truth level by itself.

## Delivery decomposition

The platform is delivered as independently specified increments:

1. `DesignDocument` and typed transaction foundation.
2. Sketch solver and exact feature kernel.
3. Persistent references, semantic tessellation, selection, and rebuild UI.
4. Assembly instances, mates, joints, collision, and clearance.
5. STEP/glTF document exchange and artifact graph.
6. Turbopump subassemblies and complete benchmark assembly.
7. General topology and implicit-field integration on named interfaces.
8. Additive analysis, support generation, and slicing.
9. FEA, CFD, thermal, and multiphysics solver adapters.
10. Persistence, durable jobs, collaboration, and production validation infrastructure.

Each increment has its own design, implementation plan, benchmark, browser proof, and truth boundary. Feature breadth cannot bypass a failed lower-level gate.

## Explicitly deferred from the first increment

The first increment does not implement freeform sculpting, production CFD, production FEA, collaborative persistence, G-code generation, or the complete turbopump. It creates the document, command, artifact, and kernel interfaces those capabilities require, with no mock solver or decorative CAD substitute.
