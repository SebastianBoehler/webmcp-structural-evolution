# WebMCP demo recording runbook

Use this runbook to record the under-three-minute Structural Evolution story on
the deployed dashboard. It demonstrates the human supervising one shared,
visible engineering state while the agent makes bounded WebMCP requests. This
is the authoritative agent sequence; the user-visible conversation uses only
the two natural requests below.

## Natural Codex dialogue

Opening request:

```text
Can we work on the reference drone? Set it up so I can inspect it before we try to reduce the frame weight.
```

After the reference drone is visible and you have inspected it, continue with:

```text
That setup looks right. Find a balanced way to reduce the frame material, then test it under the main flight loads. Show me how it behaves and flag the worst case. Leave the final decision to me.
```

## Recording setup

- Use Codex with `https://webmcp-structural-evolution.vercel.app/` open in its
  in-app browser at the intended recording width.
- Refresh the deployed dashboard, select **SE-6 six-axis cobot**, leave the
  workbench in **Assemble** with **Safety zones** off, and confirm no topology
  operation is already running.
- Open **Review → Agents**, confirm the starting assembly registrations are
  healthy, and send the opening request. Keep Safety zones off until the
  reference-drone remount is visibly complete.
- Do not open a raw gate URL, show raw JSON, or use a precomputed result.
- Never move or import a component, edit geometry, or invoke layout validation.
  Camera orbit, mode navigation, and the **Safety zones** visibility toggle do
  not change the assembly layout or its revision.

## Authoritative agent choreography

When the opening request above, or a clearly equivalent reference-drone
recording request, arrives:

1. Begin from the visible SE-6 world when it is present. Select the approved
   reference-drone assembly by calling `generate_approved_assembly` once with
   `templateId: "reference-drone"`.
2. Treat the returned keyed-remount checkpoint as a turn boundary. Stop using
   every SE-6 handle and finish with a short confirmation that the reference
   drone is ready for inspection. The next user turn must use the remounted
   workbench's fresh registrations.

After the presenter has inspected the drone and sends the continuation request:

3. Confirm **Reference FPV drone** is visibly loaded and **Review → Agents**
   shows fresh assembly, structural, simulation-review, and component
   registrations without error.
   Refetch the available tool set and use only those fresh registrations. Call
   `inspect_component_library` once with `{}` to read the exact layout state and
   movable-component centers. Then call `inspect_design_context` once with
   `scope: "current"`.
4. Use the design-context inspection's exact returned `contextRevision` as
   `parentRevision` for one `generate_topology_candidate` call with
   `variant: "balanced"`, hypothesis
   `Explore a connected frame candidate`, and prediction
   `The bounded field completes within the browser budget`.
5. Use the returned exact `branchRevision` for these
   `review_topology_case` calls, one at a time, reading each returned structural
   estimate and replay sample before continuing:
   - `{ caseId: "hover", display: "loads", geometry: "full-assembly" }`
   - `{ caseId: "roll", display: "stress", geometry: "frame-only" }`
   - `{ caseId: "pitch", display: "displacement", geometry: "frame-only" }`
   - `{ caseId: "yaw", display: "stress", geometry: "full-assembly" }`
   Include `branchRevision` in every call. Compare the returned per-case maximum
   displacement and axial-stress estimates. Identify the highest of each; do
   not invent a pass/fail threshold or treat the replay sample as a solve.
6. Leave the returned branch unverified and unaccepted. Make no component move,
   import, geometry edit, layout validation, comparison, promotion, acceptance,
   or export. Do not claim topology verification, stress FEA, manufacturing
   readiness, or flight approval. Stop after a concise summary of the topology
   estimate, reviewed case extrema, and the human review boundary.

Between requests, the presenter returns to **Assemble**, toggles **Safety zones**
on, and orbits the camera. Those display actions do not alter layout authority.
Safety zones expose protected geometry and mounted parts. Static load vectors
belong only to the Simulate/replay context; vector motion and changing readouts
belong to active playback.

## Presenter choreography

1. Orbit SE-6 in the opening. After its visible replacement and fresh tool
   registration, return to **Assemble**, turn **Safety zones** on, and orbit the
   reference drone. Do not drag or select a component for movement. Send the
   continuation request only after this supervision beat is visible.
2. When optimization switches the workbench to **Optimize**, leave the safety
   geometry visible at the start of the solve. Do not claim its display includes
   load vectors.
3. Let the agent's case-review calls switch **Simulate** among **Loads**,
   **Stress**, and **Displacement**, and between **Frame only** and **Full
   assembly**. Hold each view briefly. The generated topology must remain
   visible in both geometry modes. The agent starts each selected replay; pause
   the final replay after its moving vectors/readouts have been visible.
4. After the agent identifies the worst case and requests human review, hold the
   viewport on **Interactive estimate preview** and **Unverified · unaccepted**.
   Open **Review → Branches**, **Evidence**, and **History** in that order.
5. In **History**, show only what the post-remount ledger actually records: the
   design-context inspection and topology-candidate receipts. Assembly generation,
   component-library inspection, and view-only case review do not create receipts.

## Truth checkpoints

- The viewport result is an interactive, unverified topology estimate; it is not
  topology verification, stress FEA, or a manufacturing decision.
- **Use this frame** remains disabled. No candidate is promoted, accepted,
  exported, or presented as manufacturing-ready.
- **Evidence** separates agent prediction, interactive output, plan state, and
  human authority. **History** has the two post-remount receipts named above.
- Each case review combines the candidate's existing interactive structural
  estimate fields with a deterministic current-assembly load/rigid-body replay.
  The replay is not a new structural solve and the candidate is not an input to
  its dynamics. Neither surface is flight approval, CFD, thermal analysis,
  transient continuum FEA, verified stress FEA, or topology validation.

## Recording edit rule

The planned edited runtime is **2:46**. Keep the SE-6 opening, natural setup
request, reference-drone switch, remount/re-registration proof, safety-zone
inspection, natural continuation request, estimate truth label, review boundary,
and replay at normal speed.
If more than three seconds pass with no visible dashboard change, speed up or
jump-cut only that quiet middle and label it with the actual elapsed solve time
from this take. Do not fabricate timing or compress the tool-registration proof,
truth labels, disabled promotion, or replay boundary.

The timed storyboard in [`demo-video-script.md`](./demo-video-script.md) is the
recording order and spoken narration.
