# WebMCP demo recording runbook

Use this runbook to record the under-three-minute Structural Evolution story on
the deployed dashboard. It demonstrates the human supervising one shared,
visible engineering state while the agent makes bounded WebMCP requests.

## Recording setup

- Use Codex with `https://webmcp-structural-evolution.vercel.app/` open in its
  in-app browser at the intended recording width.
- Refresh the deployed dashboard, select **SE-6 six-axis cobot**, leave the
  workbench in **Assemble** with **Safety zones** off, and confirm no topology
  operation is already running.
- Open **Review → Agents**, confirm the SE-6 tool status is registered, and send
  Prompt 1. Do not turn on Safety zones until the reference-drone remount is
  visibly complete.
- Do not open a raw gate URL, show raw JSON, or use a precomputed result.
- Never move or import a component, edit geometry, or invoke layout validation.
  Camera orbit, mode navigation, and the **Safety zones** visibility toggle do
  not change the assembly layout or its revision.

## Prompt 1 — approved assembly only

```text
Call generate_approved_assembly once with templateId "reference-drone" only.
```

## Remount checkpoint — presenter wait, not an agent prompt

Changing the fixture remounts the workbench and disposes the SE-6 tool handles.
After the visible world switches to **Reference FPV drone**, wait for all of the
following before sending Prompt 2:

1. The reference-drone workbench has visibly finished loading.
2. **Review → Agents** shows the replacement assembly, structural, and component
   tool registration statuses without an error.
3. Codex has refetched the available WebMCP tool set and can see those newly
   registered reference-drone tools. Do not reuse an SE-6 tool handle.

During this wait, return to **Assemble**, turn **Safety zones** on, and orbit the
reference drone to expose protected geometry and mounted parts. Do not imply that
the zones show load vectors; vectors are shown later only during replay.

## Prompt 2 — inspect, then one candidate

```text
Using the fresh reference-drone WebMCP tools, call inspect_component_library with
{}. Use its returned layout state and movable component centers. Then call
inspect_design_context with scope "current". From that exact returned
contextRevision, generate exactly one balanced topology candidate with hypothesis
"Explore a connected frame candidate" and prediction "The bounded field completes
within the browser budget". Leave it as an interactive, unverified review branch:
do not move or import components, validate a layout, promote, export, compare, or
claim topology verification, stress FEA, manufacturing readiness, or flight approval.
Briefly summarize only the returned review boundary when it finishes.
```

## Required live action sequence

1. Prompt 1 calls `generate_approved_assembly` once with
   `templateId: "reference-drone"`; the visible SE-6 world changes to
   **Reference FPV drone**.
2. The presenter waits for the keyed remount, fresh tool registration, and Codex
   tool-set refetch described above.
3. Prompt 2 calls `inspect_component_library` once with `{}` to read layout
   state and actual movable-component centers, then calls
   `inspect_design_context` once with `scope: "current"`.
4. Prompt 2 calls `generate_topology_candidate` once with the exact returned
   `contextRevision` as `parentRevision`, `variant: "balanced"`, and the stated
   hypothesis and prediction.
5. Leave the result as the interactive estimate. Do not promote, accept, export,
   compare, or validate it. The disabled **Use this frame** control is the
   visible human-review boundary.

## Presenter choreography

1. Orbit SE-6 in the opening. After its visible replacement and fresh tool
   registration, return to **Assemble**, turn **Safety zones** on, and orbit the
   reference drone while Prompt 2 inspects and starts the candidate. Do not drag
   or select a component for movement.
2. When optimization switches the workbench to **Optimize**, leave the safety
   geometry visible at the start of the solve. Do not claim its display includes
   load vectors.
3. When the viewport shows **Interactive estimate preview** and **Unverified ·
   unaccepted**, hold it still long enough to read. Open **Review → Branches**,
   **Evidence**, and **History** in that order.
4. In **History**, show only what the post-remount ledger actually records: the
   design-context inspection and topology-candidate receipts. Assembly generation
   and component-library inspection do not create receipts in this flow.
5. Click **Simulate**, select **Full assembly** and one named scenario, then
   press **Run replay** once. Show moving load vectors/readouts only while replay
   is active, then pause it.

## Truth checkpoints

- The viewport result is an interactive, unverified topology estimate; it is not
  topology verification, stress FEA, or a manufacturing decision.
- **Use this frame** remains disabled. No candidate is promoted, accepted,
  exported, or presented as manufacturing-ready.
- **Evidence** separates agent prediction, interactive output, plan state, and
  human authority. **History** has the two post-remount receipts named above.
- Replay uses the current reference assembly's mass and motor mounts for
  deterministic loads and rigid-body motion only. It is not flight approval,
  CFD, thermal analysis, transient continuum FEA, or topology validation.

## Recording edit rule

The planned edited runtime is **2:46**. Keep the SE-6 opening, Prompt 1,
reference-drone switch, remount/re-registration proof, Prompt 2, safety-zone
supervision, estimate truth label, review boundary, and replay at normal speed.
If more than three seconds pass with no visible dashboard change, speed up or
jump-cut only that quiet middle and label it with the actual elapsed solve time
from this take. Do not fabricate timing or compress the tool-registration proof,
truth labels, disabled promotion, or replay boundary.

The timed storyboard in [`demo-video-script.md`](./demo-video-script.md) is the
recording order and spoken narration.
