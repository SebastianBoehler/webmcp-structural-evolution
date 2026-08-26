# Agent-Authored Component and Assembly Ingestion
Date: 2026-08-26
Status: Approved

This document extends `2026-08-26-manufacturing-grade-drone-topology-design.md`.

## Goal
An agent can take a broad request such as “design a printable 5-inch drone for this
mission,” research suitable hardware, create or source component representations,
stage them in the workbench, arrange the assembly, define protected regions and
loads, select installed physics, run optimization, and prepare a verified build
package while the human watches and intervenes in the same live application.

Humans retain the same import, placement, constraint, simulation, comparison, and
export capabilities. Agent actions are visible staged revisions, never hidden edits.

## Capability boundary
WebMCP exposes capabilities of the currently open page. It does not itself grant a
website access to arbitrary local files, web search, supplier accounts, or arbitrary
code execution.

The complete loop therefore has two cooperating planes:

- The agent harness performs web research, supplier/API queries, datasheet reading,
  CAD or mesh generation, and local file creation with its normal authorized tools.
- WebMCP imports typed results and operates the shared live assembly, simulations,
  optimizer, validation, and manufacturing UI.

A companion MCP server may later automate binary transport and supplier integrations
outside the open page. OpenAI documents that a website may support WebMCP and an MCP
server together. The challenge demo remains useful through WebMCP alone.

## Component package
The portable package is a versioned ZIP container with:

- `component.json`: identity, manufacturer/part number, units, provenance, licence,
  source timestamp, mass properties, uncertainty, and supported geometry assets;
- one display asset: GLB/glTF, OBJ, STL, 3MF, or a bounded parametric-geometry graph;
- optional STEP/STP source geometry;
- optional conservative collision and protected-volume geometry;
- mount, mate, cable, connector, cooling, access, and load interfaces;
- source documents or links plus country/availability observations; and
- SHA-256 digests for the manifest and every asset.

The package distinguishes sourced geometry, agent-reconstructed geometry, primitive
proxies, and inferred metadata. A visually detailed mesh is not automatically a
valid collision body, mount definition, or structural interface.

The bounded parametric graph supports approved primitives, transforms, extrusions,
revolves, unions, intersections, subtractions, fillets, and named interfaces. It is
data, not executable JavaScript, WGSL, Wasm, Python, or arbitrary CAD scripting.

## Ingestion paths
1. Human drag/drop or file picker imports a package or supported CAD/mesh file.
2. `stage_component_definition` creates a component from structured metadata and a
   bounded parametric graph supplied by the agent.
3. A browser-capable agent may use the visible file-import UI for a file it created.
4. A future companion MCP bridge may transfer a validated package directly.

WebMCP JSON arguments are not treated as an unlimited binary-transfer channel.
Large base64 meshes and arbitrary remote-URL fetches are excluded from site tools.
The application records a source URL but does not fetch it merely because an agent
provided it.

Imported files are parsed in a worker with strict size, type, complexity, and time
budgets. Parsing failure, unsupported entities, missing units, invalid topology, or
licence ambiguity produces a visible incomplete component rather than a substitute.

## Agent-authored assembly
The page registers state-dependent authoring tools:

- `inspect_assembly_context`: summarize scene inventory, relationships, selection,
  unresolved constraints, conflicts, and valid next actions without mutation.
- `preview_assembly_edit`: calculate a proposed edit, exact delta, and resulting
  conflicts against one parent revision without mutation.
- `stage_component_definition`: validate and stage structured component metadata,
  interfaces, protected volumes, and bounded parametric geometry.
- `place_component`: add an exact component revision and transform to a staged
  assembly branch.
- `constrain_component`: add mate, concentric, planar, axial, distance, symmetry, or
  orientation constraints between named interfaces.
- `define_protected_region`: create preserve, keep-out, access, cable, cooling,
  contact, or load regions tied to semantic geometry.
- `inspect_assembly_conflicts`: return collisions, ungrounded components, unresolved
  degrees of freedom, missing stock, missing properties, and inaccessible hardware.
- `compile_assembly`: derive mass, center of mass, inertia, BOM, design domains, and
  valid next actions from one exact staged revision.

The human can drag and mate the same components directly. Every action updates the
renderer, assembly tree, inspector, conflicts, and stale evidence immediately.

Arrangement is constraint-based rather than a pile of guessed coordinates. The
agent must resolve or disclose collisions, degrees of freedom, mount mismatch,
clearance, cable reach, service access, and center-of-mass consequences.

The interaction borrows Blender Lab's useful inspect-first pattern: query scene
relationships, find geometric or performance outliers, diagnose invalid state, and
propose visible edits for approval. It intentionally rejects Blender MCP's unsafe
arbitrary-code path; Blender's own project page warns that generated Python executes
without guards. Engineering mutations remain typed domain actions.

## Sourcing and availability
Supplier discovery occurs through the agent's authorized web/search/API tools, not
inside an unrestricted page fetcher. Each suggestion records:

- exact product and supplier identity;
- region, price/currency, availability, shipping observation, and timestamp;
- datasheet and geometry provenance;
- redistribution or use licence; and
- unresolved claims or missing specifications.

Availability is time-dependent evidence, never a permanent component property. The
human approves purchases and any use of assets with unclear redistribution rights.

If no licensed model exists, the agent may reconstruct a bounded component from
manufacturer dimensions and images. The package labels it as agent-reconstructed,
preserves the sources, states uncertainty, and requires interface verification.

## Physics and simulator selection
The app has an installed simulator registry. Each backend declares supported
physics, required inputs, fidelity, units, assumptions, outputs, performance class,
validation fixtures, and unsupported claims.

The agent may inspect this registry, propose structural, modal, thermal, pressure,
or coupled studies, and explain why each applies. It cannot upload or execute a new
solver, shader, Wasm module, or arbitrary code through WebMCP. Adding a physics
backend is a reviewed application change.

Missing inputs produce a bounded request or an explicit assumption handshake. A
study cannot be labelled verified beyond the backend's declared fidelity.

## End-to-end orchestration
1. Parse mission, location, environment, performance, budget, and manufacturing
   constraints; expose missing decisions.
2. Research and compare components with current provenance and availability.
3. Create or import typed component packages.
4. Stage and constraint-solve the assembly while the human watches.
5. Define protected geometry, mass properties, load cases, and material/process.
6. Ask for approval of safety-relevant assumptions and the selected study plan.
7. Run progressive optimization and simulations; surface failures and alternatives.
8. Compare candidates in the shared viewport and accept only through human action.
9. Independently verify reconstructed geometry and prepare the manufacturing bundle.

The application supports interruption at every stage. A human edit invalidates stale
plans and results, and the agent resumes from the new exact revision.

## Acceptance gates
- A WebMCP agent creates a component, places and constrains it, adds a keep-out and
  cable path, and compiles a valid assembly without DOM or screenshot scraping.
- The same mutations appear live and remain editable through the human UI.
- One generated parametric component and one real imported asset complete the flow.
- Invalid units, corrupted meshes, ambiguous licences, stale supplier facts, unsafe
  code, and unresolved interfaces fail visibly.
- The agent selects only an installed simulator whose declared inputs are satisfied.
- A single mission prompt can reach an approval-ready assembly and study plan; final
  candidate promotion, purchasing, and manufacturing export remain human decisions.

## Reference
- OpenAI Site tools documentation:
  <https://learn.chatgpt.com/docs/webmcp>
- Blender Lab MCP Server:
  <https://www.blender.org/lab/mcp-server/>
