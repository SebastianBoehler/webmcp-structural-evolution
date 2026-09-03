# Structural Evolution demo video script

Target: 2:35–2:50 after accelerating only quiet waits. Record the deployed
dashboard, not a raw gate route or JSON page. Start with **SE-6 six-axis cobot**
and use the one prompt in [`demo-agent-runbook.md`](./demo-agent-runbook.md).

## Timed storyboard

| Time | Clicks and visible action | Spoken narration | Edit rule |
| --- | --- | --- | --- |
| 0:00–0:12 | Start on the deployed **SE-6 six-axis cobot** in **Assemble**. Orbit its camera once; open **Review → Agents**. | “Structural Evolution is a browser-native physical-engineering workbench. I begin on this approved SE-6 assembly, where the human and agent share the same visible engineering state.” | Real time. Do not move components. |
| 0:12–0:32 | Paste the single runbook prompt. Keep the agent/tool activity visible as it calls `generate_approved_assembly` for `reference-drone`; orbit as the viewport visibly changes to **Reference FPV drone**. | “With one typed WebMCP request, the agent replaces SE-6 with the approved reference-drone template. It is selecting a known, typed assembly—not inventing arbitrary CAD—and I can supervise the same shared world as it changes.” | Real time; retain the assembly switch. |
| 0:32–0:52 | As the agent inspects the reference drone, return to **Assemble**, click **Safety zones** on, and orbit/rotate to expose protected geometry, loads, and mounted parts; do not drag or edit any component. | “The agent now inspects the exact active revision, its protected geometry, locks, and valid next action. While it works, I orbit the camera and expose safety zones. That is concurrent human supervision, without changing the layout or forcing a validation detour.” | Real time. |
| 0:52–1:23 | The agent invokes one balanced candidate from the returned revision. Keep running state and safety geometry visible. | “From that returned revision, it generates one balanced frame candidate in the browser. The request is constrained to this assembly and leaves a reviewable branch rather than changing the accepted design.” | If the middle has over three seconds without a visible change, speed up or cut only that quiet wait and label it with this take’s displayed solve time. |
| 1:23–1:43 | Hold the viewport on the resulting density field and its **interactive / unverified** label. | “Here is the visible topology preview. It is an interactive, unverified estimate—not topology verification, stress FEA, or a manufacturing decision.” | Real time; make the truth label legible. |
| 1:43–2:10 | Open **Review → Branches** and show the Balanced frame card and disabled **Use this frame**. Then open **Evidence** and **History**, keeping the action receipt visible. | “Branches shows the estimate and its measured run fields, but Use this frame is disabled. Evidence separates the agent’s prediction, the interactive output, the plan state, and human authority. History preserves the recorded assembly generation, inspection, and candidate actions for this revision.” | Real time; do not promote, export, compare, or validate. |
| 2:10–2:38 | Click **Simulate** to open **Current assembly replay**, select **Full assembly**, choose one scenario, and press **Run replay**. Show motion, load vectors, and readouts; pause after a few seconds. | “Finally, this replay uses the current reference assembly’s mass and motor mounts to visualize deterministic loads and rigid-body motion. It is not topology validation, structural stress analysis, or flight approval. The agent can propose inside the workbench; the human keeps the review boundary.” | Real time; retain the boundary copy. |
| 2:38–2:48 | Return to the still-visible reference-drone workbench, estimate preview, or review boundary. | “That is the complete loop: approved assembly, supervised WebMCP work, a clearly unverified proposal, preserved evidence, and human control.” | Real time. End before 3:00. |

## Director notes

- Use exactly one agent prompt. The deterministic action order is approved
  reference-drone generation, live inspection, then one balanced topology
  candidate from the returned revision.
- The only presenter interactions before review are camera orbit/rotation and
  **Safety zones**. No manual component move, import, layout validation, or
  geometry edit is permitted.
- The renderer may show an estimate before the review tabs. Hold that preview
  long enough to make its unverified state visible before opening **Branches**.
- If WebMCP is unavailable in the deployed recording browser, stop the live
  claim. Record the visible error and use a previously captured deployed take
  only as supporting footage, clearly labelled as such.

## Backup shots

- The deployed SE-6 opening, followed by the visible reference-drone assembly
  generation result.
- **Review → Agents** showing live tool registration/activity.
- Safety zones around the reference drone while the camera orbits.
- The unverified topology preview, **Branches** with disabled **Use this frame**,
  **Evidence**, and **History** receipt.
- One current-assembly replay frame showing motion and load readouts with its
  rigid-body/load-only boundary copy.
