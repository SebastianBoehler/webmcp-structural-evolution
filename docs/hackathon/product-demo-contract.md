# Product/Demo Contract

Deadline: 2026-09-03 13:00 PT / 2026-09-03 22:00 Europe/Berlin
Internal feature freeze: 2026-09-02 18:00 Europe/Amsterdam
Demo rehearsal window: 2026-09-02 18:00 through submission

## AI-native delivery budget

Committed core: preserve the reference drone, add one agent-authored robot-arm link,
compile both through one assembly-neutral topology-study seam, solve in the existing
worker, and present editable geometry plus truth-labelled evidence.

Expected short work cycles:

1. Generalize the solver input from FPV motor cases to named load cases.
2. Compile an explicit study and assembly into that solver input.
3. Add the robot-link assembly and prove a real solve.
4. Select, generate, and solve the fixture in the visible workbench.
5. Exercise the exact WebMCP path in the target browser.

External or uncertain dependencies: target-browser WebMCP availability, deployment,
and final model behavior. Probe these before feature freeze.

Ranked expansion options: direct constraint edit, a second robot-link variant, and a
short branch comparison. Admit at most one after the core browser path is stable.

Buffer purpose: deployment, submission evidence, backup recording, and rehearsal.

## Audience memory

After the demo, a voter should say: “The person and agent built an editable physical
assembly together, then the browser generated and tested its structure.”

## Magic moment

Actor: AI agent, supervised by the presenter.

Action: create the approved robot-arm link components, interfaces, protected joint
voids, support, payload load, material, and objective through typed WebMCP actions.

Visible result: a complete editable assembly appears in the shared 3D world, compiles
to a named structural study, and produces a topology field and evidence receipt.

Authoritative proof: visible assembly revision, study inputs, solver job status,
result fields, and immutable action receipts all refer to the same revision.

Why WebMCP matters: the agent inspects and edits the same live semantic state that the
human manipulates; it does not infer hidden CAD state from screenshots.

## Abstraction contract

Lowest stable primitive: an immutable assembly plus an explicit topology study with
SI design domain, supports, protected/access volumes, named load cases, material,
manufacturing limits, objective, and provenance.

Open-world input/generation: approved component definitions, instance transforms,
semantic interfaces, assembly constraints, region IDs, and load-case IDs.

Closed-world verification/execution: bounded typed schemas, supported box/cylinder
volumes, positive finite SI values, bounded grids, known solver adapters, and explicit
human approval for promotion/export.

Temporarily enumerated facts: optimization presets and the Rust lattice/SIMP adapter.

Second-case extension check: the robot link and drone compile through the same module
interface; solver code must not branch on fixture or component IDs.

## Canonical journey

Given: the reference drone is open and the agent can inspect the current revision.

When: the presenter asks for a robot-arm link carrying a payload between two joint
interfaces, then asks the agent to generate and optimize it.

Then: the agent creates an editable typed assembly, displays the constraints, runs a
named payload load case, and returns inspectable topology and analysis evidence.

Must not result in: arbitrary code execution, hidden mock geometry, a drone-specific
solver branch, unsupported engineering claims, or automatic manufacturing approval.

## Scope

Must build:

- Assembly-neutral study compiler and solver input.
- Arbitrary named load cases with returned per-case fields.
- Robot-arm link fixture using the same compiler and worker.
- Visible fixture selection, generation state, solve, and evidence.
- Target-browser WebMCP proof or an explicit failed/unverified gate.

Must not build:

- Free-form B-rep or STEP synthesis from natural language.
- Contact, nonlinear joints, kinematics, continuum FEA, CFD, thermal, fatigue, or
  experimental validation.
- Remote solver orchestration, accounts, collaboration servers, or a plugin system.
- Additional product templates before the two-fixture proof is stable.

Must remain unchanged:

- Current reference-drone geometry, assets, and verified topology behavior.
- Immutable revisions, stale-parent rejection, cancellation, and human promotion.
- Honest “sparse SIMP lattice estimate” language.

## Acceptance evidence

Essential invariant tests:

- Named study loads and supports preserve SI values and IDs through Wasm.
- The robot-link load interface remains connected to its fixed interface.
- The drone still compiles and solves without fixture-specific solver logic.

Critical seam check: one public compiler contract test invokes both fixtures.

Deployed demo check: in the deployed target browser, discover tools, generate the
robot-link assembly, run the solve, inspect the fields, and record a timed rehearsal.

Fallback: ship a deterministic pre-authored robot-link request plus a backup recording
of the same deployed revision. Never substitute precomputed fields for a claimed live
solve.

## Completion ledger

| Capability | State | Evidence |
|---|---|---|
| Product/demo contract | Verified | Scope and acceptance gates are encoded here and exercised by the current checks |
| Generic study compiler | Verified | Compiler contract tests plus named-case Rust and real-Wasm integration tests |
| Robot-link fixture | Verified | Conflict-free assembly, exact grid/support context, thresholded base-to-payload connectivity, and two named cases |
| Visible human/agent loop | Verified locally | In-app browser discovered WebMCP tools, generated the robot assembly, inspected `48×32×8` context, and produced visible verified evidence |
| Deployment | Specified | Working public URL required by event rules |
| Demo | Implemented locally | Public deployment, timed rehearsal, and backup recording remain open |

## Open assumptions

- “Generate full assembly” means constructing a complete assembly from approved typed
  primitives and components, not inventing arbitrary manufacturing CAD.
- The robot fixture is a single structural link/bracket between a grounded joint and
  a payload joint; kinematics and contact remain future solver disciplines.
- Internal feature freeze may move earlier, but not later, without cutting scope.
