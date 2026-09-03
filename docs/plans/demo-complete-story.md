# Complete-story demo visibility plan

## Goal

Make the deployed three-minute WebMCP demo visibly communicate the complete
judge-facing story: approved assembly generation, component/layout work,
concurrent human supervision, safety geometry,
topology optimization, review evidence, human approval, and one honest
flight-load replay.

## Global constraints

- Never present an interactive estimate as verified, accepted, or
  manufacturing-ready.
- Rendering an estimate is preview-only; promotion and export remain disabled.
- Flight replay is a deterministic rigid-body/load visualization of the current
  reference assembly, not FEA, CFD, or topology validation.
- No mock data, fallback results, hidden gate pages, or raw JSON demo surfaces.
- Keep source files at or below the repository's 300-line soft limit.
- Preserve the existing narrow WebMCP state-changing authority boundaries.
- A changed layout must require an explicit, current-version validation step
  before topology generation resumes.

## Task 1 — Truthful interactive-estimate preview

- Let the latest current, non-stale `estimate` branch appear in the central
  viewport after generation.
- Label it visibly and accessibly as an interactive, unverified, unaccepted
  preview.
- Show its density field and result metrics without enabling candidate
  comparison, promotion, export, or flight simulation.
- Add focused tests that fail on the current hidden-estimate behavior and prove
  the authority boundary remains intact.

## Task 2 — Revision-aware assembly collaboration loop

- Add an explicit typed WebMCP layout-validation operation that checks the exact
  current layout version, compiles the current assembly, and marks it verified
  only when no blocking conflicts remain.
- Make component-library inspection report layout state and the correct next
  action after either agent or human movement.
- Preserve stale-version rejection and make the visible status transition
  `changed → validating → verified` or a clear conflict error.
- Add focused tests proving a movement changes the revision, stale evidence is
  visible, validation uses the exact version, and topology may resume only after
  successful validation.

## Task 3 — Current-assembly flight-load replay

- Allow the reference drone's existing deterministic rigid-body/load replay to
  run against the current assembly without requiring topology verification.
- Keep topology-derived structural layers and claims gated; describe the replay
  as assembly loads and rigid-body motion only.
- Keep the SE-6 non-flight fixture behavior unchanged.
- Add focused tests for the enabled reference-drone replay and its truthful
  boundary copy.

## Task 4 — Retina-sharp WebGPU viewport

- Render the semantic WebGPU canvas at the current device pixel ratio, capped at
  2× to keep the recording path sharp without an unbounded GPU-memory cost.
- Preserve the canvas's CSS dimensions and responsive narrow-workspace layout;
  this is a drawing-buffer resolution change, not a simulation-grid change.
- Add focused sizing tests for normal, Retina, clamped, and invalid device pixel
  ratios.

## Task 5 — Recording choreography

- Use concise natural dialogue to select the approved reference drone, pause for
  human inspection at the remount boundary, then inspect its layout, optimize,
  and summarize the review boundary.
- Update the runbook and timed storyboard with explicit manual or browser
  actions: begin on SE-6, generate the reference drone, orbit the camera while
  the agent works, toggle Safety zones, then show the topology preview,
  Branches, Evidence, History, and one flight replay.
- Do not edit component geometry during the recording; demonstrate human-agent
  collaboration through simultaneous viewport supervision without introducing
  a layout-validation detour.
- Keep the final sequence under three minutes after accelerating only quiet
  waiting time.
- Do not claim every internal solver or gate; show the complete coherent story.

## Success check

- Focused tests cover preview truth state, disabled promotion, and assembly
  flight replay, plus Retina WebGPU sizing.
- Production build passes.
- At the recording width, the deployed dashboard visibly changes through each
  story beat without exposing private or gate-only surfaces.
