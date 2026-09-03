# WebMCP demo recording runbook

Use this runbook to record the under-three-minute Structural Evolution story on
the deployed dashboard. It demonstrates one shared engineering state: the agent
changes it through typed WebMCP actions while the presenter supervises it in the
viewport.

## Recording setup

- Use Codex with `https://webmcp-structural-evolution.vercel.app/` open in its
  in-app browser at the intended recording width.
- Refresh the deployed dashboard, select **SE-6 six-axis cobot**, and leave the
  shared workbench visible. No topology operation may already be running.
- Begin in **Assemble** with **Safety zones** off. After the reference drone is
  generated, the presenter may return to **Assemble** to turn them on while the
  agent continues. Then open **Review → Agents** for the single prompt.
- Do not open a raw gate URL, show raw JSON, or use a precomputed result.
- Never move a component, import a component, or invoke layout validation in
  this recording. Camera orbit and the **Safety zones** visibility toggle are
  supervision only; they do not change the assembly layout or its revision.

## One paste-ready prompt

Use this once, after the setup shot. Do not send a separate inspection,
generation, or follow-up prompt.

```text
Use the deployed dashboard's live WebMCP tools. First generate the approved
reference-drone assembly with templateId "reference-drone". Then inspect the
current design context with scope "current". From the returned contextRevision,
generate exactly one balanced topology candidate with hypothesis "Explore a
connected frame candidate" and prediction "The bounded field completes within
the browser budget". Leave it as an interactive, unverified review branch: do
not promote, export, validate a layout, or claim structural verification,
manufacturing readiness, or flight approval. Briefly summarize the returned
review boundary when the candidate finishes.
```

## Required agent sequence

1. Call `generate_approved_assembly` once with `templateId: "reference-drone"`.
   Confirm the visible world changes from SE-6 to **Reference FPV drone**.
2. Call `inspect_design_context` once with `scope: "current"`. Read the returned
   `contextRevision`, protected volumes, locks, capability, and next actions.
   Stop and report the live error if the context is stale or WebGPU is unavailable.
3. Call `generate_topology_candidate` once using that exact `contextRevision` as
   `parentRevision`, `variant: "balanced"`, and the hypothesis and prediction
   from the prompt.
4. Leave the result as the interactive estimate branch. Do not promote, accept,
   export, compare, or validate it. The disabled **Use this frame** control is
   the visible human-review boundary.
5. In the final response, repeat only returned values and the boundary: this is
   an interactive topology estimate pending further engineering review; the
   later replay is assembly loads and rigid-body motion, not topology validation
   or flight approval.

## Presenter choreography

While the agent performs the sequence, the presenter does only these visible
supervision actions:

1. During the approved-assembly switch, orbit/rotate the camera around SE-6 and
   then the newly visible reference drone. Do not drag, select for movement, or
   alter any component.
2. Once the reference drone appears, switch to **Assemble** while the agent
   continues inspection/candidate generation, click **Safety zones** on, and
   orbit the camera to expose the protected geometry and mounted parts. Leave
   the zones visible through the start of the solve. Mode/camera/visibility
   controls do not change layout state.
3. When the estimate appears in the viewport, pause camera movement briefly so
   the **Interactive estimate / unverified** state and density preview are
   legible. Then open **Review → Branches**, **Evidence**, and **History** in
   that order.
4. Open the current-assembly replay, select **Full assembly**, choose one named
   scenario, and press **Run replay** once. Keep a moving load/vector frame and
   its rigid-body/load readouts visible for a few seconds, then pause it.

## Truth checkpoints

- The viewport preview is a visible interactive, unverified topology estimate.
  It is neither topology verification nor stress FEA.
- **Use this frame** is disabled for that estimate. No branch is promoted,
  accepted, exported, or presented as manufacturing-ready.
- **Evidence** separates agent prediction, measured interactive output, plan
  state, and human authority. **History** supplies the action receipt tied to
  the current revision.
- Replay uses the current reference assembly's mass and motor mounts for
  deterministic loads and rigid-body motion only. It is not flight approval,
  CFD, thermal analysis, transient continuum FEA, or topology validation.

## Recording edit rule

Keep the opening SE-6 shot, prompt submission, agent tool activity, assembly
switch, safety-zone supervision, estimate reveal, review boundary, and replay at
normal speed. If more than three seconds pass with no visible dashboard change,
speed up or jump-cut only that quiet middle. Label any accelerated solve segment
with the actual elapsed time displayed in that take. Do not fabricate a solve
duration or compress the truth labels, disabled promotion control, or replay
boundary.

The timed storyboard in [`demo-video-script.md`](./demo-video-script.md) is the
recording order and spoken narration.
