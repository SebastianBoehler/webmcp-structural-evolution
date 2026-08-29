# Detailed Six-Axis Cobot Fixture

Date: 2026-08-29

Status: Design approved in chat; written specification awaiting review

## Decision summary

Replace the current `robot-arm-link` proxy with an original, fully dimensioned six-axis tabletop cobot fixture. The fixture must be as visually legible and semantically detailed as the reference drone while preserving an honest engineering boundary: only the upper-arm link participates in the current topology study.

The fixture is an original Sunderlabs design, provisionally named **SE-6**. Dimensions, masses, materials, payload, and load cases are qualified design assumptions. It must not claim compatibility with, performance equivalent to, or provenance from a commercial robot.

Success is visible before reading labels: a reviewer can identify the base, shoulder, elbow, forearm, three-axis wrist, gripper, and payload in the default camera view. After optimization, the generated structure must replace or overlay the upper-arm member between the shoulder and elbow while the complete robot remains visible.

## Product role

The SE-6 is the second proof fixture for the domain-neutral workbench. It exists to demonstrate that the assembly compiler, study schema, rendering seams, and WebMCP tools are not limited to a four-motor FPV drone.

The demo proves:

- a detailed non-drone assembly can use the same component, assembly, load-case, and solver contracts;
- a solver-owned structural member can remain contextualized inside a larger editable assembly;
- the browser and agent can inspect the same semantic robot hierarchy and analysis evidence;
- named load cases and transferred assembly mass properties are not drone-specific.

It does not prove whole-robot kinematics, joint/contact simulation, controls, collision-free motion planning, certified payload capacity, or continuum finite-element analysis.

## Visual and semantic assembly

The default pose is a recognizable industrial-arm hero pose: the pedestal is vertical, the shoulder is elevated, the elbow is bent, and the wrist and gripper reach forward with a mounted payload. The full robot occupies most of the viewport.

The assembly contains 52 placed semantic instances across these groups:

1. **Base:** mounting plate, mounting fasteners, pedestal body, turntable, J1 bearing ring, motor cover, and cable entry.
2. **Shoulder:** two-sided yoke, J2 joint barrel, bearing caps, fasteners, guard, and strain relief.
3. **Upper arm:** preserved shoulder boss, solver-owned topology body, preserved elbow boss, joint fasteners, an external service cover, and a protected central cable corridor. No fixed structural envelope may obscure or duplicate the generated member.
4. **Elbow and forearm:** J3 barrel and caps, elbow guard, forearm shell, cable covers, and cover fasteners.
5. **Wrist:** distinct J4 roll, J5 pitch, and J6 tool-roll housings with visible axes, spacers, covers, and fasteners.
6. **Tooling:** ISO-like but explicitly generic tool flange, parallel gripper body, two jaws, fingertip pads, and a mechanically mounted calibration payload.
7. **Services:** a segmented cable loom routed from the shoulder through the arm to the wrist, with visible clamps and strain-relief pieces.

Every visual part maps back to a stable semantic component or assembly-instance identifier for selection and inspection. Decorative subparts may share their owning component identifier, but no visible object may be an unowned scene-only prop.

The palette separates functional classes without implying analysis results: structural shells, joint housings, covers/guards, fasteners, cables, tooling, and payload. Constraint and result colors remain reserved for fixed regions, loads, protected regions, and density/stress visualization.

## Dimensional and provenance policy

The fixture uses millimetres for authored geometry and kilograms for mass input, compiled explicitly to SI units at the solver boundary. Its catalog records the source of each value as `qualified-assumption` with a short rationale.

The assembly frame is right-handed: `+Z` is up, `+X` is the nominal reach direction, and `+Y` is lateral. The locked hero pose is `J1 = 20°`, `J2 = -35°`, `J3 = 70°`, `J4 = 0°`, `J5 = 35°`, and `J6 = 0°`. Joint angles are authored in degrees for the fixture and converted explicitly to radians by the transform layer.

The reference dimensions and masses are qualified assumptions, not product specifications:

| Feature | Locked value |
| --- | ---: |
| Base mounting plate | 260 × 260 × 18 mm |
| Pedestal height above plate | 250 mm |
| J1/J2 nominal housing diameter | 190 / 170 mm |
| Shoulder-axis height | 340 mm |
| J2-to-J3 axis distance | 420 mm |
| J3-to-J4 axis distance | 360 mm |
| J4-to-tool-flange distance | 210 mm |
| Generic tool flange diameter | 80 mm |
| Gripper body / maximum opening | 130 × 90 × 70 mm / 90 mm |
| Calibration payload | 1.5 kg, 100 × 80 × 60 mm |
| Base and pedestal mass | 9.0 kg |
| Shoulder and J2 assembly mass | 4.2 kg |
| Authored upper-arm interface mass | 1.4 kg excluding generated infill |
| Elbow and forearm mass | 4.0 kg |
| Wrist stack mass | 2.3 kg |
| Gripper mass | 1.1 kg |
| Cable, covers, and fasteners mass | 0.8 kg |

The upper-arm local frame uses `+X` from the J2 axis toward J3. Its initial design domain is 360 × 130 × 110 mm, positioned between two preserved bosses with 68 mm outer radius, 42 mm bearing-interface radius, and 24 mm axial thickness. The protected cable corridor is a 28 mm diameter swept cylinder. Four 10 mm diameter access corridors protect the assumed joint-fastener paths. These values remain visible and editable assumptions in the compiled study receipt.

The first implementation must provide explicit values for:

- joint-axis locations and orientations;
- component envelopes, transforms, mass, and local center of mass;
- attachment interfaces between adjacent links and tooling;
- rated calibration payload and payload center of mass;
- upper-arm design-domain bounds;
- preserved bearing interfaces, protected cable corridor, and tool-access voids;
- material and manufacturing assumptions;
- load magnitudes, directions, application regions, and combination weights.

No field may silently rely on display scale, viewport coordinates, or an implicit unit conversion.

## Upper-arm structural study

Only the member spanning J2 at the shoulder to J3 at the elbow is optimized. The surrounding robot supplies context and derived loading but remains rigid visual geometry.

The study contains:

- an axis-aligned local design domain covering the upper-arm member;
- preserved annular/boss regions at the shoulder and elbow interfaces;
- a protected cable/service corridor through the member;
- explicit fastener and maintenance access voids;
- a fixed shoulder interface;
- distal loads derived from the modeled forearm, wrist, gripper, and payload mass and center of mass;
- a PA12 manufacturing/material profile, with `E = 1.7 GPa`, `ν = 0.39`, and `ρ = 1010 kg/m³` identified as qualified room-temperature isotropic estimates rather than batch-specific test data;
- the current sparse SIMP lattice solver and its existing validation status.

The visual pose and the solver-local coordinate system are connected by an explicit transform. Load vectors are transformed once at the compiler boundary and remain traceable to their assembly-frame source. The generic compiler must not branch on `robot-arm`, `SE-6`, or fixture identifiers.

### Named load cases

1. `rated-payload-gravity`: standard gravity, `9.80665 m/s²`, applied to the modeled distal mass properties in the hero pose.
2. `emergency-stop`: a qualified `2 g` tangential deceleration of the modeled distal mass, combined with gravity and stated in the receipt.
3. `lateral-disturbance`: a qualified `150 N` side load at the tool/payload interface, combined with gravity.

The UI and WebMCP results must retain these names. Integer positions or drone-specific load aliases are not acceptable substitutes.

The result label is **interactive sparse-lattice estimate**. Stress, displacement, compliance, and safety-factor values may be shown only with the existing solver limitations. The application must state that continuum FEA, joint compliance, fatigue, buckling, and experimental validation are pending.

## Rendering seam

The generic assembly renderer must remain domain-neutral. A fixture-owned visual-detail adapter expands semantic instances into compound primitives or curated meshes and returns the common `AssemblyVisualPart` contract.

The cobot adapter may produce several render primitives for one semantic component, but each primitive carries:

- stable visual and owning semantic identifiers;
- local-to-world transform;
- shape or resource reference;
- material/appearance token;
- semantic group and selection role;
- whether it is analysis context, design region, constraint, or generated result.

The application workspace accepts an optional fixture renderer through the fixture contract. The default adapter continues to handle ordinary catalog envelopes, and the drone keeps its existing behavior. Fixture-ID conditionals must not be added to solver, compiler, workspace, or generic rendering modules.

The cobot adapter should reuse existing box, cylinder, mesh, and transform primitives where they produce a credible silhouette. Any new generic primitive must describe reusable geometry rather than a robot-specific drawing command.

## Browser behavior

Selecting **SE-6 six-axis cobot** in the fixture control loads the full assembly and frames it automatically. The study subject is displayed as **upper arm**, not as the whole robot.

Before a run, the workbench shows the authored upper-arm shell or design region in its installed position. During study inspection, fixed interfaces, protected corridors, access voids, and named load vectors can be toggled without hiding the robot. During and after a run, progressive density or the extracted result is mapped into the upper-arm position while the rest of the assembly remains visible.

Selections expose the semantic path—for example `SE-6 / shoulder / J2 housing`—and the owning component assumptions. The mounted payload must never appear as a floating, uncontextualized cube.

Existing WebMCP tools continue to operate on the active fixture:

- inspection returns the cobot hierarchy, active upper-arm study, assumptions, and available actions;
- study configuration preserves the three named load cases and semantic regions;
- optimization runs against an immutable compiled snapshot;
- candidate comparison reports normalized metrics and validation state;
- no tool claims whole-arm simulation or motion capability.

## Public verification seams

Implementation follows red-green tests at these agreed public boundaries:

1. **Fixture and assembly contract:** six distinct joint axes, 52 placed parts, required semantic groups, attached gripper and payload, valid inventory quantities, and no assembly conflicts.
2. **Visual adapter contract:** whole-arm world bounds, stable semantic ownership, distinct base/shoulder/elbow/wrist/tool regions, mapped upper-arm design region, and no detached payload.
3. **Compiler contract:** exact unit normalization, design-domain transform, protected cable corridor, preserved interfaces, three named load cases, and distal/total mass and center-of-mass transfer without fixture-specific branches.
4. **Solver integration:** the thresholded density field connects the shoulder and elbow interface regions while respecting the protected corridor and required access volumes at the locked test resolution.
5. **Browser/WebMCP path:** fixture selection renders the complete arm before solving; inspection, study generation, and optimization operate on the cobot; receipts describe the upper-arm estimate honestly.
6. **Regression boundary:** the reference drone renders, compiles, and runs unchanged.

## Visual acceptance gates

The implementation is not complete based on unit tests alone. A real browser check at desktop and narrow viewport widths must confirm:

- the arm is immediately recognizable without labels;
- base, shoulder, elbow, forearm, wrist, gripper, and payload are visually separable;
- the full arm is framed and occupies most of the viewport;
- cables, guards, covers, interfaces, and fasteners provide detail comparable to the drone;
- the upper-arm design region is physically located between shoulder and elbow;
- a generated result stays attached to both interfaces and does not obscure the rest of the robot;
- selection and evidence panels identify the upper arm as the solved member;
- no large unexplained box, isolated ring, or topology cloud remains.

Screenshots are evidence only after these checks pass. Production deployment is a separate gate after local browser acceptance; the existing Vercel deployment must not be updated merely because the build passes.

## Error handling

Missing component geometry, invalid transforms, non-finite mass properties, disconnected interfaces, load-case mapping failures, renderer ownership gaps, and solver non-convergence are visible errors. The application must not replace a failed cobot load or solve with the drone, saved topology, generic placeholder geometry, or mock metrics.

## Non-goals for this stage

- reproducing a named commercial robot or importing proprietary CAD;
- inverse/forward kinematics, animation, motion planning, or collision avoidance;
- motor, gearbox, bearing, joint-contact, controls, or thermal simulation;
- whole-arm topology optimization or continuum FEA;
- a general natural-language robot generator;
- backend persistence, multi-user collaboration, or remote solver infrastructure;
- STEP/B-rep manufacturing export for the cobot;
- certification, rated-load, lifetime, or safety claims.

## Implementation order

After this written specification is approved, the implementation plan should sequence work by dependency:

1. lock fixture, compiler, visual, and browser tests at the public seams;
2. add the original catalog assumptions and semantic assembly hierarchy;
3. add the fixture-owned visual adapter and workspace seam;
4. compile the upper-arm study and derived distal loading;
5. integrate progressive/generated results in the installed member transform;
6. verify the complete browser and WebMCP path locally;
7. perform a focused regression review and full project check;
8. request visual acceptance before any production deployment.

Hand-authored source files should stay below the repository's 300-line soft limit. The cobot fixture should be split by catalog, assembly, study, and visual-detail responsibility rather than collected in one model file.
