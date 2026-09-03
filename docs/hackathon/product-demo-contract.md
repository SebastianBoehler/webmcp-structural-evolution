# Product/Demo Contract

Deadline: 2026-09-03 13:00 PT / 2026-09-03 22:00 Europe/Berlin
Internal feature freeze: 2026-09-02 18:00 Europe/Amsterdam
Demo rehearsal window: 2026-09-02 18:00 through submission

## AI-native delivery budget

Committed core: preserve the reference drone as the primary public story, keep the
shared dashboard truthful, run one balanced topology candidate through the existing
worker, and present editable geometry plus truth-labelled evidence. Keep the SE-6
fixture only as secondary proof that the same architecture spans another assembly.

Expected short work cycles:

1. Generalize the solver input from FPV motor cases to named load cases.
2. Compile an explicit study and assembly into that solver input.
3. Preserve a truthful reference-drone public path in the visible workbench.
4. Keep the secondary SE-6 proof on the same compiler and worker seam.
5. Exercise the exact WebMCP path in the target browser.

External or uncertain dependencies: target-browser WebMCP availability, deployment,
and final model behavior. Probe these before feature freeze.

Ranked expansion options: direct constraint edit, a second fixture variant, and a
short branch comparison. Admit at most one after the core browser path is stable.

Buffer purpose: deployment, submission evidence, backup recording, and rehearsal.

## Audience memory

After the demo, a voter should say: “The person and agent built an editable physical
assembly together, then the browser generated and tested its structure.”

## Magic moment

Actor: AI agent, supervised by the presenter.

Action: inspect the current reference-drone state, then ask for one balanced
topology candidate through typed WebMCP actions.

Visible result: the shared reference-drone workbench stays in sync, the browser
produces a reviewable balanced-frame estimate, and the receipt/evidence panels stay
attached to the same revision the human is supervising.

Authoritative proof: visible assembly revision, solver job status, result fields, the
estimate label, and immutable action receipts all refer to the same revision.

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

Second-case extension check: the SE-6 proof and drone compile through the same module
interface; solver code must not branch on fixture or component IDs.

## Canonical journey

Given: the reference drone is open and the agent can inspect the current revision.

When: the presenter asks the agent to inspect the current context, generate a
balanced topology candidate from that exact current revision, and review its four
named flight-load cases in the shared viewport.

Then: the agent returns a reviewable estimate branch, displays its load, stress, and
displacement-magnitude fields with and without mounted components, identifies the
returned case extrema, and stops for human review. Promotion remains unavailable
until a human selects an eligible verified branch.

Must not result in: arbitrary code execution, hidden mock geometry, a drone-specific
solver branch, unsupported engineering claims, or automatic manufacturing approval.

## Scope

Must build:

- Assembly-neutral study compiler and solver input.
- Arbitrary named load cases with returned per-case fields.
- Reference-drone public path with visible inspection, candidate generation state,
  estimate, and review evidence.
- Secondary SE-6 proof using the same compiler and worker seam.
- Target-browser WebMCP proof or an explicit failed/unverified gate.

Must not build:

- Free-form B-rep or STEP synthesis from natural language.
- Contact, nonlinear joints, kinematics, continuum FEA, CFD, thermal, fatigue, or
  experimental validation.
- Remote solver orchestration, accounts, collaboration servers, or a plugin system.
- Additional product templates before the reference-drone public path is stable.

Must remain unchanged:

- Current reference-drone geometry, assets, and verified topology behavior.
- Immutable revisions, stale-parent rejection, cancellation, and human promotion.
- Honest “sparse SIMP lattice estimate” language.

## Acceptance evidence

Essential invariant tests:

- Named study loads and supports preserve SI values and IDs through Wasm.
- The reference drone still compiles and solves without fixture-specific solver logic.
- The SE-6 secondary proof still compiles through the same assembly-neutral seam.

Critical seam check: one public compiler contract test invokes both fixtures.

Deployed demo check: in the deployed target browser, inspect the current
reference-drone context, generate one balanced candidate, inspect the resulting
estimate/evidence, display all four named cases, and confirm the human-only promotion
boundary.

Fallback: ship the deterministic reference-drone request path plus a backup recording
of the same deployed revision. Never substitute precomputed fields for a claimed live
browser estimate.

## Completion ledger

| Capability | State | Evidence |
|---|---|---|
| Product/demo contract | Verified | Scope and acceptance gates are encoded here and exercised by the current checks |
| Generic study compiler | Verified | Compiler contract tests plus named-case Rust and real-Wasm integration tests |
| SE-6 secondary proof | Verified | SE-6 upper-arm and mechanism routes remain covered by the existing component/integration test surface |
| Deployment | Verified | Public demo is live at `https://webmcp-structural-evolution.vercel.app` |
| In-app WebMCP inspection | Verified | Production in-app browser registered seven tools, inspection ran on the deployed reference drone, and the shared review flow remained available |
| Deployed topology case review | Verified | Production commit `bc346dc` generated the balanced estimate in `15,218 ms`; `review_topology_case` then displayed hover/load/full-assembly, roll/stress/frame-only, pitch/displacement/frame-only, and yaw/stress/full-assembly with returned case extrema while keeping the branch unverified and unaccepted |
| Timed production rehearsal | Verified | On 2026-09-02 the deployed `generate_topology_candidate` run completed in `13,211 ms` with status `estimate`, material `33.5%`, compliance `0.001348`, and a reviewable Balanced frame branch while `Use this frame` remained disabled |
| Deployed complete-story rehearsal | Verified | One continuous Codex in-app-browser automated deployed Vercel preview rehearsal of `9d4e921` started on SE-6, switched to the reference drone, refetched six fresh tools without registration error, then completed live inspection/candidate/review/replay beats in `71.230 s` of automated UI/tool-path time. No saved video capture exists; see the Task 5 report for exact dimensions and timing boundaries. |
| Final public video | Open | Only the single public video URL remains to be recorded/published |
| Final Devpost action | Open | Drafting is complete locally; the final Devpost submission step remains intentionally undone |

## Open assumptions

- “Generate full assembly” means constructing a complete assembly from approved typed
  primitives and components, not inventing arbitrary manufacturing CAD.
- The public video starts on SE-6. A natural setup request visibly switches to
  the approved reference drone; after the human inspects it, a natural
  continuation starts the fresh-tool inspection/candidate path. SE-6 is the
  opening workflow state, not a topology or flight-validation claim.
- SE-6 remains secondary proof of architectural span rather than the primary judge
  story.
- Internal feature freeze may move earlier, but not later, without cutting scope.
